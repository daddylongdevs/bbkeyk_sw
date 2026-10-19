import { Game } from '../scenes/Game';
import { Data } from '../../tmp_backend/Data';
import { Grid } from '../../tmp_backend/SymbolDetector';
import { gameEventManager, GameEventType } from '../../event/EventManager';
import { gameStateManager } from '../../managers/GameStateManager';
import { TurboConfig } from '../../config/TurboConfig';
import { SpinData, PaylineData } from '../../backend/SpinData';
import { MULTIPLIER_SYMBOLS } from '../../config/GameConfig';


export class WinLineDrawer {
  public scene: Game;
  public container: Phaser.GameObjects.Container;
  private lines: Phaser.GameObjects.Graphics[] = [];
  private symbolsReference: any;
  private currentWinPatterns: [number, Grid[]][] = []; // [lineKey, winningGrids][]
  private isLooping: boolean = false;
  private loopTimer?: Phaser.Time.TimerEvent;
  private hasEmittedFirstLoopWinStop: boolean = false;
  private symbolOverlay?: Phaser.GameObjects.Graphics;
  private wasInterruptedByManualSpin: boolean = false;
  
  // Configurable timing intervals (in milliseconds)
  private lineDisplayTime: number = 250;     // How long each line stays visible after drawing (increased from 750ms)
  private cycleEndPause: number = 250;      // Extra pause at the end of a complete cycle (increased from 750ms)
  private animationSpeed: number = 2;      // Speed multiplier for drawing animation (1.0 = normal)
  
  // Minimum display times to ensure visibility (especially important in turbo mode)
  private minLineDisplayTime: number = 500;  // Increased minimum time each line must be visible
  private minCycleEndPause: number = 800;     // Increased minimum pause at end of cycle
  
  // Store original values for turbo mode restoration
  private originalLineDisplayTime?: number;
  private originalCycleEndPause?: number;
  private originalAnimationSpeed?: number;

  constructor(scene: Game, symbolsReference: any) {
    this.scene = scene;
    this.symbolsReference = symbolsReference;
    this.container = scene.add.container(0, 0);
    // Set high depth to ensure lines draw above symbols
    this.container.setDepth(800);
  }

  /**
   * Draw lines for all winning patterns with looping sequence (legacy Data method)
   */
  public drawWinLines(data: Data): void {
    this.stopLooping();
    this.clearLines();
    
    if (!data.wins || data.wins.allMatching.size === 0) {
      console.log('[WinLineDrawer] No wins to draw lines for');
      return;
    }

    // Store win patterns for looping
    this.currentWinPatterns = Array.from(data.wins.allMatching.entries());
    this.isLooping = true;
    this.hasEmittedFirstLoopWinStop = false;
    this.wasInterruptedByManualSpin = false;
    
    // Start the looping sequence
    this.drawWinLinesSequentially(0);
  }

  /**
   * Draw lines for all winning patterns with looping sequence (new SpinData method)
   */
  public drawWinLinesFromSpinData(spinData: SpinData): void {
    this.stopLooping();
    this.clearLines();
    
    if (!spinData.slot.paylines || spinData.slot.paylines.length === 0) {
      console.log('[WinLineDrawer] No paylines to draw lines for');
      return;
    }

    // Convert SpinData paylines to win patterns format
    this.currentWinPatterns = this.convertPaylinesToWinPatterns(spinData);
    this.isLooping = true;
    this.hasEmittedFirstLoopWinStop = false;
    this.wasInterruptedByManualSpin = false;
    
    // Emit WIN_START to pause autoplay during winline animations
    console.log('[WinLineDrawer] Emitting WIN_START for winline animations (looping)');
    gameEventManager.emit(GameEventType.WIN_START);
    
    // Start the looping sequence
    this.drawWinLinesSequentially(0);
  }

  /**
   * Draw lines for all winning patterns once (for autoplay) then emit completion (legacy Data method)
   */
  public drawWinLinesOnce(data: Data): void {
    this.stopLooping();
    this.clearLines();
    
    if (!data.wins || data.wins.allMatching.size === 0) {
      console.log('[WinLineDrawer] No wins to draw lines for (once)');
      // No wins, clear any existing overlay and emit completion immediately
      if (this.symbolsReference && this.symbolsReference.hideWinningOverlay) {
        this.symbolsReference.hideWinningOverlay();
      }
      // Emit completion immediately for no-win scenarios
      gameEventManager.emit(GameEventType.WIN_STOP);
      return;
    }

    // Store win patterns for single pass
    this.currentWinPatterns = Array.from(data.wins.allMatching.entries());
    this.isLooping = false; // Not looping, just single pass
    this.wasInterruptedByManualSpin = false;
    
    // Safety check: ensure we have patterns to draw
    if (this.currentWinPatterns.length === 0) {
      console.log('[WinLineDrawer] No win patterns stored, emitting WIN_STOP immediately');
      gameEventManager.emit(GameEventType.WIN_STOP);
      return;
    }
    
    // Start the single-pass sequence
    this.drawWinLinesSequentiallyOnce(0);
  }

  /**
   * Draw lines for all winning patterns once (for autoplay) then emit completion (new SpinData method)
   */
  public drawWinLinesOnceFromSpinData(spinData: SpinData): void {
    this.stopLooping();
    this.clearLines();
    
    if (!spinData.slot.paylines || spinData.slot.paylines.length === 0) {
      console.log('[WinLineDrawer] No paylines to draw lines for (once)');
      // No wins, clear any existing overlay and emit completion immediately
      if (this.symbolsReference && this.symbolsReference.hideWinningOverlay) {
        this.symbolsReference.hideWinningOverlay();
      }
      // Emit completion immediately for no-win scenarios
      // Add small delay to ensure free spin autoplay is ready
      this.scene.time.delayedCall(50, () => {
        console.log('[WinLineDrawer] Emitting WIN_STOP for no-wins scenario');
        gameEventManager.emit(GameEventType.WIN_STOP);
      });
      return;
    }

    // Convert SpinData paylines to win patterns format
    this.currentWinPatterns = this.convertPaylinesToWinPatterns(spinData);
    this.isLooping = false; // Not looping, just single pass
    this.wasInterruptedByManualSpin = false;
    
    // Safety check: ensure we have patterns to draw
    if (this.currentWinPatterns.length === 0) {
      console.log('[WinLineDrawer] No win patterns stored, emitting WIN_STOP immediately');
      gameEventManager.emit(GameEventType.WIN_STOP);
      return;
    }
    
    // Emit WIN_START to pause autoplay during winline animations
    console.log('[WinLineDrawer] Emitting WIN_START for winline animations');
    gameEventManager.emit(GameEventType.WIN_START);
    
    // Start the single-pass sequence
    this.drawWinLinesSequentiallyOnce(0);
  }

  /**
   * Draw win lines one by one, removing previous line (single pass for autoplay)
   */
  private drawWinLinesSequentiallyOnce(currentIndex: number): void {
    if (this.currentWinPatterns.length === 0) {
      console.log('[WinLineDrawer] No win patterns to draw, emitting WIN_STOP immediately');
      gameEventManager.emit(GameEventType.WIN_STOP);
      return;
    }

    // Only clear lines at the start of the sequence, not between each line
    if (currentIndex === 0) {
      this.clearLines();
    }

    const [winlineIndex, winningGrids] = this.currentWinPatterns[currentIndex];
    
    
    // Get the complete winline pattern for continuity
    const completeWinlineGrids = this.getCompleteWinlineGrids(winlineIndex);
    
    // Draw the current line with animation and wait for completion
    this.drawWinLineWithCallbackAndBrightness(completeWinlineGrids, winningGrids, winlineIndex, () => {
      // Animation completed, check if we have more lines
      const nextIndex = currentIndex + 1;
      
      if (nextIndex < this.currentWinPatterns.length) {
        // More lines to show, clear current line and continue after display time
        
        this.loopTimer = this.scene.time.delayedCall(this.lineDisplayTime, () => {
          // Clear the current line before drawing the next one
          this.clearLines();
          this.drawWinLinesSequentiallyOnce(nextIndex);
        });
      } else {
        // All lines shown, wait then emit completion
        
        this.loopTimer = this.scene.time.delayedCall(this.cycleEndPause, () => {
          // Check if we're in any type of autoplay (normal or free spin)
          const isNormalAutoplay = gameStateManager.isAutoPlaying;
          const isFreeSpinAutoplay = this.symbolsReference && (this.symbolsReference as any).freeSpinAutoplayActive;
          const isAnyAutoplay = isNormalAutoplay || isFreeSpinAutoplay;
          
          if (isAnyAutoplay) {
            // Add extra delay before clearing winlines to ensure they're visible
            this.scene.time.delayedCall(300, () => {
              this.clearLines();
              // Also clear the overlay when autoplay winlines complete
              if (this.symbolsReference && this.symbolsReference.hideWinningOverlay) {
                this.symbolsReference.hideWinningOverlay();
              }
              console.log('[WinLineDrawer] Cleared win lines and overlay (autoplay) after extra delay');
            });
          } else {
            console.log('[WinLineDrawer] Preserving win lines and overlay (manual spin)');
          }
          gameEventManager.emit(GameEventType.REELS_STOP);
          gameEventManager.emit(GameEventType.WIN_STOP);
        });
      }
    });
  }

  /**
   * Draw win lines one by one, removing previous line and looping
   */
  private drawWinLinesSequentially(currentIndex: number): void {
    if (!this.isLooping || this.currentWinPatterns.length === 0) {
      return;
    }

    // Clear any existing line
    this.clearLines();

    const [winlineIndex, winningGrids] = this.currentWinPatterns[currentIndex];
    
    // Get the complete winline pattern for continuity
    const completeWinlineGrids = this.getCompleteWinlineGrids(winlineIndex);
    
    // Draw the current line with animation and wait for completion
    this.drawWinLineWithCallbackAndBrightness(completeWinlineGrids, winningGrids, winlineIndex, () => {
      // Animation completed, now wait before showing next line
      const nextIndex = (currentIndex + 1) % this.currentWinPatterns.length;
      const isEndOfCycle = nextIndex === 0;
      const displayTime = isEndOfCycle ? this.cycleEndPause : this.lineDisplayTime;
      
      if (isEndOfCycle) {
        console.log('[WinLineDrawer] Completed full cycle, will restart loop');
      }
      
      this.loopTimer = this.scene.time.delayedCall(displayTime, () => {
        if (isEndOfCycle && !this.hasEmittedFirstLoopWinStop) {
          console.log('[WinLineDrawer] First loop completed - emitting REELS_STOP and WIN_STOP before continuing to loop');
          this.hasEmittedFirstLoopWinStop = true;
          gameEventManager.emit(GameEventType.REELS_STOP);
          gameEventManager.emit(GameEventType.WIN_STOP);
        }
        if (this.isLooping) {
          this.drawWinLinesSequentially(nextIndex);
        }
      });
    });
  }

  /**
   * Draw a win line with a completion callback
   */
  private drawWinLineWithCallback(winningGrids: Grid[], winlineIndex: number, onComplete: () => void): void {
    if (winningGrids.length < 2) {
      onComplete();
      return;
    }

    // Neon colors - bright, vibrant colors that don't repeat
    const neonColors = [
      0x00FF41, // Neon Green
      0xFF0080, // Hot Pink
      0x00BFFF, // Deep Sky Blue
      0xFFFF00, // Electric Yellow
      0xFF4500, // Orange Red
      0x8A2BE2, // Blue Violet
      0x00FFFF, // Cyan
      0xFF1493, // Deep Pink
      0x32CD32, // Lime Green
      0xFF6347, // Tomato
      0x9370DB, // Medium Purple
      0x00FA9A, // Medium Spring Green
      0xFF69B4, // Hot Pink 2
      0x1E90FF, // Dodger Blue
      0xFFD700, // Gold
      0xDA70D6, // Orchid
      0x7FFF00, // Chartreuse
      0xFF4500, // Red Orange
      0x40E0D0, // Turquoise
      0xEE82EE  // Violet
    ];
    
    // Ensure we don't repeat colors by using the winline index directly
    const lineColor = neonColors[winlineIndex % neonColors.length];
    
    // Create path points for all winning symbols with horizontal extensions
    const pathPoints: { x: number, y: number }[] = [];
    const extensionLength = 100; // Pixels to extend horizontally
    
    // First, get all symbol positions
    const symbolPositions: { x: number, y: number }[] = [];
    for (let i = 0; i < winningGrids.length; i++) {
      const grid = winningGrids[i];
      const pos = this.getSymbolCenterPosition(grid.x, grid.y);
      symbolPositions.push(pos);
    }
    
    // Find leftmost and rightmost positions based on actual X coordinates
    let leftmostIndex = 0;
    let rightmostIndex = 0;
    
    for (let i = 1; i < symbolPositions.length; i++) {
      if (symbolPositions[i].x < symbolPositions[leftmostIndex].x) {
        leftmostIndex = i;
      }
      if (symbolPositions[i].x > symbolPositions[rightmostIndex].x) {
        rightmostIndex = i;
      }
    }
    
    // Alternative approach: Use grid bounds for perfect symmetry
    const leftmostPos = symbolPositions[leftmostIndex];
    const rightmostPos = symbolPositions[rightmostIndex];
    
    // Calculate the center point between leftmost and rightmost
    const centerX = (leftmostPos.x + rightmostPos.x) / 2;
    const span = rightmostPos.x - leftmostPos.x;
    
    // Debug: Check if grid is centered properly
    const screenCenterX = this.scene.scale.width * 0.5;
    
    // Option 1: Extensions relative to payline center (current)
    // const leftExtensionX = centerX - (span / 2) - extensionLength;
    // const rightExtensionX = centerX + (span / 2) + extensionLength;
    
    // Option 2: Extensions relative to screen center (might look more balanced)
    const leftExtensionX = screenCenterX - (span / 2) - extensionLength;
    const rightExtensionX = screenCenterX + (span / 2) + extensionLength;
    const gridCenterX = this.symbolsReference.slotX || screenCenterX;
    
    // Build path with perfectly symmetric extensions
    for (let i = 0; i < symbolPositions.length; i++) {
      const pos = symbolPositions[i];
      
      // Add horizontal extension to leftmost point (perfectly symmetric)
      if (i === leftmostIndex) {
        pathPoints.push({ x: leftExtensionX, y: pos.y });
      }
      
      // Add the actual symbol position
      pathPoints.push(pos);
      
      // Add horizontal extension to rightmost point (perfectly symmetric)
      if (i === rightmostIndex) {
        pathPoints.push({ x: rightExtensionX, y: pos.y });
      }
    }

    // Create graphics object for this line
    const graphics = this.scene.add.graphics();
    this.container.add(graphics);
    this.lines.push(graphics);

    // Start the animated drawing with completion callback
    this.animateLineDrawWithCallback(graphics, pathPoints, lineColor, winlineIndex, onComplete);
  }

  /**
   * Draw a win line with different brightness for winning vs connecting segments
   */
  private drawWinLineWithCallbackAndBrightness(completeGrids: Grid[], winningGrids: Grid[], winlineIndex: number, onComplete: () => void): void {
    if (completeGrids.length < 2) {
      onComplete();
      return;
    }

    // Neon colors - bright, vibrant colors that don't repeat
    const neonColors = [
      0x00FF41, // Neon Green
      0xFF0080, // Hot Pink
      0x00BFFF, // Deep Sky Blue
      0xFFFF00, // Electric Yellow
      0xFF4500, // Orange Red
      0x8A2BE2, // Blue Violet
      0x00FFFF, // Cyan
      0xFF1493, // Deep Pink
      0x32CD32, // Lime Green
      0xFF6347, // Tomato
      0x9370DB, // Medium Purple
      0x00FA9A, // Medium Spring Green
      0xFF69B4, // Hot Pink 2
      0x1E90FF, // Dodger Blue
      0xFFD700, // Gold
      0xDA70D6, // Orchid
      0x7FFF00, // Chartreuse
      0xFF4500, // Red Orange
      0x40E0D0, // Turquoise
      0xEE82EE  // Violet
    ];
    
    // Ensure we don't repeat colors by using the winline index directly
    const lineColor = neonColors[winlineIndex % neonColors.length];
    
    // Create set of winning positions for quick lookup
    const winningPositions = new Set<string>();
    for (const grid of winningGrids) {
      winningPositions.add(`${grid.x},${grid.y}`);
    }
    
    // Check if all symbols in the complete winline are winning (complete win)
    const allSymbolsWinning = completeGrids.every(grid => 
      winningPositions.has(`${grid.x},${grid.y}`)
    );
    
    // Create path points for all symbols with horizontal extensions and brightness info
    const pathPoints: { x: number, y: number, isWinning: boolean }[] = [];
    const extensionLength = 50; // Pixels to extend horizontally
    
    // First, get all symbol positions
    const symbolPositions: { x: number, y: number, isWinning: boolean }[] = [];
    for (let i = 0; i < completeGrids.length; i++) {
      const grid = completeGrids[i];
      const pos = this.getSymbolCenterPosition(grid.x, grid.y);
      // If all symbols are winning, mark all as winning; otherwise use actual winning status
      const isWinning = allSymbolsWinning || winningPositions.has(`${grid.x},${grid.y}`);
      symbolPositions.push({ ...pos, isWinning });
    }
    
    // Find leftmost and rightmost positions based on actual X coordinates
    let leftmostIndex = 0;
    let rightmostIndex = 0;
    
    for (let i = 1; i < symbolPositions.length; i++) {
      if (symbolPositions[i].x < symbolPositions[leftmostIndex].x) {
        leftmostIndex = i;
      }
      if (symbolPositions[i].x > symbolPositions[rightmostIndex].x) {
        rightmostIndex = i;
      }
    }
    
    // Debug: Check if grid is centered properly
    const screenCenterX = this.scene.scale.width * 0.5;
    const leftmostPos = symbolPositions[leftmostIndex];
    const rightmostPos = symbolPositions[rightmostIndex];
    const centerX = (leftmostPos.x + rightmostPos.x) / 2;
    const span = rightmostPos.x - leftmostPos.x;
    
    // Extensions relative to screen center for perfect symmetry
    const leftExtensionX = screenCenterX - (span / 2) - extensionLength;
    const rightExtensionX = screenCenterX + (span / 2) + extensionLength;
    
    // Build path with extensions at actual leftmost and rightmost points
    for (let i = 0; i < symbolPositions.length; i++) {
      const pos = symbolPositions[i];
      
      // Add horizontal extension to leftmost point (extend left)
      if (i === leftmostIndex) {
        pathPoints.push({ x: leftExtensionX, y: pos.y, isWinning: allSymbolsWinning }); // Extensions are winning if all symbols are winning
      }
      
      // Add the actual symbol position
      pathPoints.push(pos);
      
      // Add horizontal extension to rightmost point (extend right)
      if (i === rightmostIndex) {
        pathPoints.push({ x: rightExtensionX, y: pos.y, isWinning: allSymbolsWinning }); // Extensions are winning if all symbols are winning
      }
    }

    // Create graphics object for this line
    const graphics = this.scene.add.graphics();
    this.container.add(graphics);
    this.lines.push(graphics);

    // Play winline SFX when starting to draw the line
    // Start the animated drawing with brightness variation
    this.animateLineDrawWithBrightness(graphics, pathPoints, lineColor, winlineIndex, onComplete);
  }

  /**
   * Draw a single win line connecting the centers of winning symbols with animation
   */
  private drawWinLine(winningGrids: Grid[], winlineIndex: number): void {
    if (winningGrids.length < 2) {
      return;
    }

    // Neon colors - bright, vibrant colors that don't repeat
    const neonColors = [
      0x00FF41, // Neon Green
      0xFF0080, // Hot Pink
      0x00BFFF, // Deep Sky Blue
      0xFFFF00, // Electric Yellow
      0xFF4500, // Orange Red
      0x8A2BE2, // Blue Violet
      0x00FFFF, // Cyan
      0xFF1493, // Deep Pink
      0x32CD32, // Lime Green
      0xFF6347, // Tomato
      0x9370DB, // Medium Purple
      0x00FA9A, // Medium Spring Green
      0xFF69B4, // Hot Pink 2
      0x1E90FF, // Dodger Blue
      0xFFD700, // Gold
      0xDA70D6, // Orchid
      0x7FFF00, // Chartreuse
      0xFF4500, // Red Orange
      0x40E0D0, // Turquoise
      0xEE82EE  // Violet
    ];
    
    // Ensure we don't repeat colors by using the winline index directly
    const lineColor = neonColors[winlineIndex % neonColors.length];
    
    // Create path points for all winning symbols
    const pathPoints: { x: number, y: number }[] = [];
    for (let i = 0; i < winningGrids.length; i++) {
      const grid = winningGrids[i];
      const pos = this.getSymbolCenterPosition(grid.x, grid.y);
      pathPoints.push(pos);
    }

    // Create graphics object for this line
    const graphics = this.scene.add.graphics();
    this.container.add(graphics);
    this.lines.push(graphics);

    // Start the animated drawing
    this.animateLineDraw(graphics, pathPoints, lineColor, winlineIndex);

  }

  /**
   * Animate the line drawing from first symbol to last
   */
  private animateLineDraw(graphics: Phaser.GameObjects.Graphics, pathPoints: { x: number, y: number }[], lineColor: number, winlineIndex: number): void {
    this.animateLineDrawWithCallback(graphics, pathPoints, lineColor, winlineIndex, () => {
      // No callback needed for the original method
    });
  }

  /**
   * Animate line drawing with brightness variation for winning vs connecting segments
   */
  private animateLineDrawWithBrightness(graphics: Phaser.GameObjects.Graphics, pathPoints: { x: number, y: number, isWinning: boolean }[], lineColor: number, winlineIndex: number, onComplete: () => void): void {
    const totalSegments = pathPoints.length - 1;
    if (totalSegments <= 0) {
      onComplete();
      return;
    }
    
    // Calculate total path length for smooth animation
    let totalLength = 0;
    const segmentLengths: number[] = [];
    
    for (let i = 0; i < totalSegments; i++) {
      const startPoint = pathPoints[i];
      const endPoint = pathPoints[i + 1];
      const length = Math.sqrt(
        Math.pow(endPoint.x - startPoint.x, 2) + 
        Math.pow(endPoint.y - startPoint.y, 2)
      );
      segmentLengths.push(length);
      totalLength += length;
    }
    
    // Animation parameters for consistent drawing speed
    const pixelsPerSecond = 800; // Consistent drawing speed in pixels per second
    const baseDuration = Math.max(500, (totalLength / pixelsPerSecond) * 1000); // Convert to milliseconds
    const totalDuration = baseDuration / this.animationSpeed; // Apply speed multiplier
    
    // Single smooth animation from 0 to 1
    this.scene.tweens.add({
      targets: { progress: 0 },
      progress: 1,
      duration: totalDuration,
      ease: 'Power1.easeOut', // Smooth easing
      onUpdate: (tween) => {
        const progress = (tween.targets[0] as any).progress;
        
        // Clear and redraw the line up to current progress
        graphics.clear();
        this.drawSmoothLineToProgressWithBrightness(graphics, pathPoints, segmentLengths, totalLength, progress, lineColor);
      },
      onComplete: () => {
        // Animation complete - start pulsing effect and call completion callback
        this.startLinePulse(graphics);
        onComplete();
      }
    });
  }

  /**
   * Animate the line drawing from first symbol to last with completion callback
   */
  private animateLineDrawWithCallback(graphics: Phaser.GameObjects.Graphics, pathPoints: { x: number, y: number }[], lineColor: number, winlineIndex: number, onComplete: () => void): void {
    const totalSegments = pathPoints.length - 1;
    if (totalSegments <= 0) {
      onComplete();
      return;
    }
    
    // Calculate total path length for smooth animation
    let totalLength = 0;
    const segmentLengths: number[] = [];
    
    for (let i = 0; i < totalSegments; i++) {
      const startPoint = pathPoints[i];
      const endPoint = pathPoints[i + 1];
      const length = Math.sqrt(
        Math.pow(endPoint.x - startPoint.x, 2) + 
        Math.pow(endPoint.y - startPoint.y, 2)
      );
      segmentLengths.push(length);
      totalLength += length;
    }
    
    // Animation parameters for consistent drawing speed
    const pixelsPerSecond = 500; // Consistent drawing speed in pixels per second
    const baseDuration = Math.max(500, (totalLength / pixelsPerSecond) * 1000); // Convert to milliseconds
    const totalDuration = baseDuration / this.animationSpeed; // Apply speed multiplier
    
    // Single smooth animation from 0 to 1
    this.scene.tweens.add({
      targets: { progress: 0 },
      progress: 1,
      duration: totalDuration,
      ease: 'Power1.easeOut', // Smooth easing
      onUpdate: (tween) => {
        const progress = (tween.targets[0] as any).progress;
        
        // Clear and redraw the line up to current progress
        graphics.clear();
        this.drawSmoothLineToProgress(graphics, pathPoints, segmentLengths, totalLength, progress, lineColor);
      },
      onComplete: () => {
        // Animation complete - start pulsing effect and call completion callback
        this.startLinePulse(graphics);
        onComplete();
      }
    });
  }

  /**
   * Draw the line up to a specific progress point (legacy method)
   */
  private drawLineToProgress(graphics: Phaser.GameObjects.Graphics, pathPoints: { x: number, y: number }[], currentSegment: number, progress: number, lineColor: number): void {
    // This method is kept for backward compatibility but is no longer used
    // The smooth drawing is now handled by drawSmoothLineToProgress
  }

  /**
   * Draw the line smoothly up to a specific progress along the entire path
   */
  private drawSmoothLineToProgress(graphics: Phaser.GameObjects.Graphics, pathPoints: { x: number, y: number }[], segmentLengths: number[], totalLength: number, progress: number, lineColor: number): void {
    if (pathPoints.length < 2 || progress <= 0) return;

    // Calculate how far along the total path we should draw
    const targetLength = totalLength * progress;
    let currentLength = 0;
    const drawPoints: { x: number, y: number }[] = [pathPoints[0]]; // Always start with first point
    
    // Find which segments to include and where to stop
    for (let i = 0; i < segmentLengths.length; i++) {
      const segmentLength = segmentLengths[i];
      
      if (currentLength + segmentLength <= targetLength) {
        // Include entire segment
        currentLength += segmentLength;
        drawPoints.push(pathPoints[i + 1]);
      } else {
        // Include partial segment
        const remainingLength = targetLength - currentLength;
        const segmentProgress = remainingLength / segmentLength;
        
        const startPoint = pathPoints[i];
        const endPoint = pathPoints[i + 1];
        const interpolatedPoint = {
          x: startPoint.x + (endPoint.x - startPoint.x) * segmentProgress,
          y: startPoint.y + (endPoint.y - startPoint.y) * segmentProgress
        };
        
        drawPoints.push(interpolatedPoint);
        break;
      }
    }

    if (drawPoints.length < 2) return;

    // Draw outer glow
    graphics.lineStyle(12, lineColor, 0.4);
    graphics.beginPath();
    graphics.moveTo(drawPoints[0].x, drawPoints[0].y);
    for (let i = 1; i < drawPoints.length; i++) {
      graphics.lineTo(drawPoints[i].x, drawPoints[i].y);
    }
    graphics.strokePath();

    // Draw main line
    graphics.lineStyle(6, lineColor, 1.0);
    graphics.beginPath();
    graphics.moveTo(drawPoints[0].x, drawPoints[0].y);
    for (let i = 1; i < drawPoints.length; i++) {
      graphics.lineTo(drawPoints[i].x, drawPoints[i].y);
    }
    graphics.strokePath();

    // Draw inner core
    graphics.lineStyle(3, 0xFFFFFF, 0.8);
    graphics.beginPath();
    graphics.moveTo(drawPoints[0].x, drawPoints[0].y);
    for (let i = 1; i < drawPoints.length; i++) {
      graphics.lineTo(drawPoints[i].x, drawPoints[i].y);
    }
    graphics.strokePath();

    // Add rounded caps
    graphics.fillStyle(lineColor, 0.4);
    graphics.fillCircle(drawPoints[0].x, drawPoints[0].y, 6); // Start cap (glow)
    
    graphics.fillStyle(lineColor, 1.0);
    graphics.fillCircle(drawPoints[0].x, drawPoints[0].y, 3); // Start cap (main)
    
    graphics.fillStyle(0xFFFFFF, 0.8);
    graphics.fillCircle(drawPoints[0].x, drawPoints[0].y, 1.5); // Start cap (core)

    // Add end cap at current drawing position
    const endPoint = drawPoints[drawPoints.length - 1];
    graphics.fillStyle(lineColor, 0.4);
    graphics.fillCircle(endPoint.x, endPoint.y, 6); // End cap (glow)
    
    graphics.fillStyle(lineColor, 1.0);
    graphics.fillCircle(endPoint.x, endPoint.y, 3); // End cap (main)
    
    graphics.fillStyle(0xFFFFFF, 0.8);
    graphics.fillCircle(endPoint.x, endPoint.y, 1.5); // End cap (core)
  }

  /**
   * Draw the line smoothly with brightness variation for winning vs connecting segments
   */
  private drawSmoothLineToProgressWithBrightness(graphics: Phaser.GameObjects.Graphics, pathPoints: { x: number, y: number, isWinning: boolean }[], segmentLengths: number[], totalLength: number, progress: number, lineColor: number): void {
    if (pathPoints.length < 2 || progress <= 0) return;

    // Calculate how far along the total path we should draw
    const targetLength = totalLength * progress;
    let currentLength = 0;
    const drawPoints: { x: number, y: number, isWinning: boolean }[] = [pathPoints[0]]; // Always start with first point
    
    // Find which segments to include and where to stop
    for (let i = 0; i < segmentLengths.length; i++) {
      const segmentLength = segmentLengths[i];
      
      if (currentLength + segmentLength <= targetLength) {
        // Include entire segment
        currentLength += segmentLength;
        drawPoints.push(pathPoints[i + 1]);
      } else {
        // Include partial segment
        const remainingLength = targetLength - currentLength;
        const segmentProgress = remainingLength / segmentLength;
        
        const startPoint = pathPoints[i];
        const endPoint = pathPoints[i + 1];
        const interpolatedPoint = {
          x: startPoint.x + (endPoint.x - startPoint.x) * segmentProgress,
          y: startPoint.y + (endPoint.y - startPoint.y) * segmentProgress,
          isWinning: endPoint.isWinning // Use destination point's winning status
        };
        
        drawPoints.push(interpolatedPoint);
        break;
      }
    }

    if (drawPoints.length < 2) return;

    // Group consecutive segments by brightness for continuous drawing
    const segmentGroups: { brightness: number, points: { x: number, y: number }[] }[] = [];
    let currentGroup: { brightness: number, points: { x: number, y: number }[] } | null = null;
    
    for (let i = 0; i < drawPoints.length - 1; i++) {
      const startPoint = drawPoints[i];
      const endPoint = drawPoints[i + 1];
      
      // Segment is bright if:
      // 1. It's the very first segment (always bright)
      // 2. BOTH start and end points are winning (for segments between winning symbols)
      const segmentBrightness = (i === 0 || (startPoint.isWinning && endPoint.isWinning)) ? 1.0 : 0.4;

      
      // Start new group if brightness changes or it's the first segment
      if (!currentGroup || currentGroup.brightness !== segmentBrightness) {
        if (currentGroup) {
          segmentGroups.push(currentGroup);
        }
        currentGroup = {
          brightness: segmentBrightness,
          points: [startPoint, endPoint]
        };
      } else {
        // Add to existing group (only add endpoint to avoid duplicates)
        currentGroup.points.push(endPoint);
      }
    }
    
    // Add the last group
    if (currentGroup) {
      segmentGroups.push(currentGroup);
    }
    
    // Draw each group as a continuous path with proper line joins
    for (const group of segmentGroups) {
      if (group.points.length < 2) continue;
      
      // Draw outer glow as continuous path
      graphics.lineStyle(12, lineColor, 0.4 * group.brightness);
      graphics.beginPath();
      graphics.moveTo(group.points[0].x, group.points[0].y);
      for (let i = 1; i < group.points.length; i++) {
        graphics.lineTo(group.points[i].x, group.points[i].y);
      }
      graphics.strokePath();

      // Draw main line as continuous path
      graphics.lineStyle(6, lineColor, 1.0 * group.brightness);
      graphics.beginPath();
      graphics.moveTo(group.points[0].x, group.points[0].y);
      for (let i = 1; i < group.points.length; i++) {
        graphics.lineTo(group.points[i].x, group.points[i].y);
      }
      graphics.strokePath();

      // Draw inner core as continuous path
      graphics.lineStyle(3, 0xFFFFFF, 0.8 * group.brightness);
      graphics.beginPath();
      graphics.moveTo(group.points[0].x, group.points[0].y);
      for (let i = 1; i < group.points.length; i++) {
        graphics.lineTo(group.points[i].x, group.points[i].y);
      }
      graphics.strokePath();
    }

    // Add rounded caps with appropriate brightness
    const firstPoint = drawPoints[0];
    const lastPoint = drawPoints[drawPoints.length - 1];
    
    // Start cap - bright if first point is winning
    const startBrightness = firstPoint.isWinning ? 1.0 : 0.4;
    graphics.fillStyle(lineColor, 0.4 * startBrightness);
    graphics.fillCircle(firstPoint.x, firstPoint.y, 6); // Start cap (glow)
    
    graphics.fillStyle(lineColor, 1.0 * startBrightness);
    graphics.fillCircle(firstPoint.x, firstPoint.y, 3); // Start cap (main)
    
    graphics.fillStyle(0xFFFFFF, 0.8 * startBrightness);
    graphics.fillCircle(firstPoint.x, firstPoint.y, 1.5); // Start cap (core)

    // End cap at current drawing position - bright if last point is winning
    const endBrightness = lastPoint.isWinning ? 1.0 : 0.4;
    graphics.fillStyle(lineColor, 0.4 * endBrightness);
    graphics.fillCircle(lastPoint.x, lastPoint.y, 6); // End cap (glow)
    
    graphics.fillStyle(lineColor, 1.0 * endBrightness);
    graphics.fillCircle(lastPoint.x, lastPoint.y, 3); // End cap (main)
    
    graphics.fillStyle(0xFFFFFF, 0.8 * endBrightness);
    graphics.fillCircle(lastPoint.x, lastPoint.y, 1.5); // End cap (core)
  }

  /**
   * Start the pulsing effect after line drawing is complete
   */
  private startLinePulse(graphics: Phaser.GameObjects.Graphics): void {
    this.scene.tweens.add({
      targets: graphics,
      alpha: 0.8,
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
  }

  /**
   * Calculate the center position of a symbol based on grid coordinates
   */
  private getSymbolCenterPosition(gridX: number, gridY: number): { x: number, y: number } {
    // Use the same positioning logic as Symbols.ts
    const displayWidth = this.symbolsReference.displayWidth || 68;
    const displayHeight = this.symbolsReference.displayHeight || 68;
    const horizontalSpacing = this.symbolsReference.horizontalSpacing || 10;
    const verticalSpacing = this.symbolsReference.verticalSpacing || 5;
    
    const symbolTotalWidth = displayWidth + horizontalSpacing;
    const symbolTotalHeight = displayHeight + verticalSpacing;
    
    const totalGridWidth = this.symbolsReference.totalGridWidth;
    const totalGridHeight = this.symbolsReference.totalGridHeight;
    const slotX = this.symbolsReference.slotX;
    const slotY = this.symbolsReference.slotY;
    
    const startX = slotX - totalGridWidth * 0.5;
    const startY = slotY - totalGridHeight * 0.5;
    
    const x = startX + gridX * symbolTotalWidth + symbolTotalWidth * 0.5;
    const y = startY + gridY * symbolTotalHeight + symbolTotalHeight * 0.5;
    
    return { x, y };
  }

  /**
   * Convert SpinData paylines to win patterns format for compatibility
   */
  private convertPaylinesToWinPatterns(spinData: SpinData): [number, Grid[]][] {
    const winPatterns: [number, Grid[]][] = [];
    
    for (const payline of spinData.slot.paylines) {
      const lineKey = payline.lineKey;
      const winningGrids = this.getWinningGridsForPayline(spinData, payline);
      
      if (winningGrids.length > 0) {
        winPatterns.push([lineKey, winningGrids]);
      }
    }
    
    return winPatterns;
  }

  /**
   * Get winning grids for a specific payline from SpinData
   */
  private getWinningGridsForPayline(spinData: SpinData, payline: PaylineData): Grid[] {
    const winningGrids: Grid[] = [];
    const lineKey = payline.lineKey;
    const count = payline.count;
    
    // Get the winline pattern for this lineKey
    if (lineKey < 0 || lineKey >= Data.WINLINES.length) {
      console.warn(`[WinLineDrawer] Invalid lineKey: ${lineKey}`);
      return [];
    }
    
    const winline = Data.WINLINES[lineKey];
    
    // Get all positions in the winline pattern (where winline[y][x] === 1)
    const winlinePositions: { x: number, y: number }[] = [];
    for (let x = 0; x < winline[0].length; x++) {
      for (let y = 0; y < winline.length; y++) {
        if (winline[y][x] === 1) {
          winlinePositions.push({ x, y });
        }
      }
    }
    
    // Sort positions by x coordinate to get left-to-right order
    winlinePositions.sort((a, b) => a.x - b.x);
    
    // Take only the first 'count' positions as winning symbols
    const winningPositions = winlinePositions.slice(0, count);
    
    // Add the winning positions to the result (SpinData.area is [column][row], bottom->top)
    for (const pos of winningPositions) {
      const colLen = spinData.slot.area[pos.x]?.length || 0;
      const rowIndex = Math.max(0, colLen - 1 - pos.y);
      const symbolAtPosition = spinData.slot.area[pos.x][rowIndex];
      winningGrids.push(new Grid(pos.x, pos.y, symbolAtPosition));
    }
    
    return winningGrids;
  }

  /**
   * Get complete winline pattern grids for continuity
   */
  private getCompleteWinlineGrids(winlineIndex: number): Grid[] {
    if (winlineIndex < 0 || winlineIndex >= Data.WINLINES.length) {
      console.warn(`[WinLineDrawer] Invalid winline index: ${winlineIndex}`);
      return [];
    }

    const winline = Data.WINLINES[winlineIndex];
    const completeGrids: Grid[] = [];

    // Extract all positions where the winline has a 1 (complete pattern)
    for (let x = 0; x < winline[0].length; x++) {
      for (let y = 0; y < winline.length; y++) {
        if (winline[y][x] === 1) {
          // Create a dummy grid for positioning (symbol value doesn't matter for line drawing)
          completeGrids.push(new Grid(x, y, 0));
        }
      }
    }
    return completeGrids;
  }

  /**
   * Stop the looping animation
   */
  public stopLooping(): void {
    this.isLooping = false;
    if (this.loopTimer) {
      this.loopTimer.remove();
      this.loopTimer = undefined;
    }
  }

  /**
   * Clear all drawn lines
   */
  public clearLines(): void {
    this.lines.forEach(line => {
      // Stop any tweens on the line before destroying
      this.scene.tweens.killTweensOf(line);
      line.destroy();
    });
    this.lines = [];
  }

  /**
   * Check if there are currently active win lines
   */
  public hasActiveLines(): boolean {
    return this.lines.length > 0 || this.currentWinPatterns.length > 0;
  }

  /**
   * Animate a single line appearing with neon glow effect (legacy method)
   * Note: This is now handled by the animated drawing system
   */
  private animateSingleLine(line: Phaser.GameObjects.Graphics): void {
    // The animation is now handled by animateLineDraw method
    // This method is kept for backward compatibility but does nothing
  }

  /**
   * Animate all lines appearing with neon glow effect (legacy method for backward compatibility)
   */
  public animateLines(): void {
    this.lines.forEach((line, index) => {
      setTimeout(() => {
        this.animateSingleLine(line);
      }, index * 150);
    });
  }

  /**
   * Animate the lines disappearing
   */
  public fadeOutLines(duration: number = 1000): Promise<void> {
    this.stopLooping(); // Stop looping when fading out
    
    return new Promise((resolve) => {
      if (this.lines.length === 0) {
        resolve();
        return;
      }

      let completedTweens = 0;
      const totalTweens = this.lines.length;

      this.lines.forEach((line, index) => {
        // Stop any existing pulsing animations
        this.scene.tweens.killTweensOf(line);
        
        this.scene.tweens.add({
          targets: line,
          alpha: 0,
          duration: duration,
          delay: index * 100,
          ease: 'Power2',
          onComplete: () => {
            completedTweens++;
            if (completedTweens === totalTweens) {
              this.clearLines();
              resolve();
            }
          }
        });
      });
    });
  }

  /**
   * Configure the timing intervals for line drawing
   */
  public setTimingIntervals(options: {
    lineDisplayTime?: number;    // Time each line stays visible (default: 1500ms)
    cycleEndPause?: number;      // Extra pause at end of cycle (default: 2000ms)  
    animationSpeed?: number;     // Animation speed multiplier (default: 1.0)
  }): void {
    if (options.lineDisplayTime !== undefined) {
      this.lineDisplayTime = Math.max(500, options.lineDisplayTime); // Minimum 500ms
    }
    if (options.cycleEndPause !== undefined) {
      this.cycleEndPause = Math.max(800, options.cycleEndPause); // Minimum 800ms
    }
    if (options.animationSpeed !== undefined) {
      this.animationSpeed = Math.max(0.1, Math.min(3.0, options.animationSpeed)); // Clamp between 0.1x and 3.0x
    }
    
  }

  /**
   * Get current timing configuration
   */
  public getTimingIntervals(): { lineDisplayTime: number, cycleEndPause: number, animationSpeed: number } {
    return {
      lineDisplayTime: this.lineDisplayTime,
      cycleEndPause: this.cycleEndPause,
      animationSpeed: this.animationSpeed
    };
  }

  /**
   * Quick preset configurations for common use cases
   */
  public setTimingPreset(preset: 'fast' | 'normal' | 'slow' | 'showcase'): void {
    switch (preset) {
      case 'fast':
        this.setTimingIntervals({
          lineDisplayTime: 1000,      // Increased from 800ms
          cycleEndPause: 1500,        // Increased from 1200ms
          animationSpeed: 1.5
        });
        break;
      case 'normal':
        this.setTimingIntervals({
          lineDisplayTime: 1800,      // Increased from 1500ms
          cycleEndPause: 2500,        // Increased from 2000ms
          animationSpeed: 1.0
        });
        break;
      case 'slow':
        this.setTimingIntervals({
          lineDisplayTime: 3000,      // Increased from 2500ms
          cycleEndPause: 4000,        // Increased from 3500ms
          animationSpeed: 0.7
        });
        break;
      case 'showcase':
        this.setTimingIntervals({
          lineDisplayTime: 4000,      // Increased from 3000ms
          cycleEndPause: 5000,        // Increased from 4000ms
          animationSpeed: 0.5
        });
        break;
    }
  }

  /**
   * Apply turbo mode timing (4x faster animations)
   */
  public setTurboMode(isEnabled: boolean): void {
    if (isEnabled) {
      // Store original values for restoration (only if not already stored)
      if (this.originalLineDisplayTime === undefined) {
        this.originalLineDisplayTime = this.lineDisplayTime;
        this.originalCycleEndPause = this.cycleEndPause;
        this.originalAnimationSpeed = this.animationSpeed;
      }
      
      // Apply turbo speed using centralized TurboConfig
      this.setTimingIntervals({
        lineDisplayTime: Math.max(this.minLineDisplayTime, this.lineDisplayTime * TurboConfig.TURBO_DURATION_MULTIPLIER),
        cycleEndPause: Math.max(this.minCycleEndPause, this.cycleEndPause * TurboConfig.TURBO_DURATION_MULTIPLIER),
        animationSpeed: this.animationSpeed * TurboConfig.WINLINE_ANIMATION_SPEED_MULTIPLIER
      });
      
    } else {
      // Restore original values
      if (this.originalLineDisplayTime !== undefined && this.originalCycleEndPause !== undefined && this.originalAnimationSpeed !== undefined) {
        this.setTimingIntervals({
          lineDisplayTime: Math.max(this.minLineDisplayTime, this.originalLineDisplayTime),
          cycleEndPause: Math.max(this.minCycleEndPause, this.originalCycleEndPause),
          animationSpeed: this.originalAnimationSpeed
        });
        
      } else {
        console.warn('[WinLineDrawer] No original values stored, cannot restore timing');
      }
    }
  }

  /**
   * Reset to default timing values (useful for debugging or clean state)
   */
  public resetToDefaultTiming(): void {
    this.lineDisplayTime = 1200;     // Default line display time (increased from 750ms)
    this.cycleEndPause = 1000;       // Default cycle end pause (increased from 750ms)
    this.animationSpeed = 1.5;      // Default animation speed
    
    // Clear stored original values
    this.originalLineDisplayTime = undefined;
    this.originalCycleEndPause = undefined;
    this.originalAnimationSpeed = undefined;
  }

  /**
   * Check if the first loop of win lines has completed
   */
  public hasFirstLoopCompleted(): boolean {
    return this.hasEmittedFirstLoopWinStop;
  }

  /**
   * Check if the win line animation was interrupted by a manual spin
   */
  public wasInterruptedBySpin(): boolean {
    return this.wasInterruptedByManualSpin;
  }

  /**
   * Reset the interrupted flag (called when starting a new spin)
   */
  public resetInterruptedFlag(): void {
    this.wasInterruptedByManualSpin = false;
  }

  /**
   * Force emit WIN_STOP if the first loop hasn't completed yet
   * This is used when the player manually presses spin before the win animation completes
   */
  public forceEmitWinStopIfNeeded(): void {
    if (!this.hasEmittedFirstLoopWinStop && this.isLooping) {
      console.log('[WinLineDrawer] First loop not completed - forcing WIN_STOP emission');
      this.hasEmittedFirstLoopWinStop = true;
      this.wasInterruptedByManualSpin = true; // Mark that this was interrupted by manual spin
      
      // Stop the looping animation to prevent further win line drawing
      this.stopLooping();
      
      // Clear any existing lines
      this.clearLines();
      
      // Hide winning overlay if it exists
      if (this.symbolsReference && this.symbolsReference.hideWinningOverlay) {
        this.symbolsReference.hideWinningOverlay();
      }
      
      // Emit the required events
      gameEventManager.emit(GameEventType.REELS_STOP);
      gameEventManager.emit(GameEventType.WIN_STOP);
    }
  }

  /**
   * Destroy the component
   */
  public destroy(): void {
    this.stopLooping();
    this.clearLines();
    this.container.destroy();
  }
} 