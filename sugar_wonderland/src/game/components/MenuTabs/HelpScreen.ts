import { Scene, GameObjects } from 'phaser';
import type { ContentSection, ContentItem, HeaderOpts, ImageOpts, TextOpts, LineBreakOpts, GridOpts, GridCell, RowOpts, BorderOpts, RichTextPart, RichTextPlaceholderImage } from './ContentSection';
import { gameRulesContent } from './help_screen_content/GameRulesContent';
import { getPayoutContent } from './help_screen_content/PayoutContent';
import { getRtpContent } from './help_screen_content/RTPContent';
import { getMaxWinContent } from './help_screen_content/MaxWinContent';
import { freeSpinContent } from './help_screen_content/FreeSpinRulesContent';
import { gameSettingsContent } from './help_screen_content/GameSettingsContent';
import { howToPlayContent } from './help_screen_content/HowToPlayContent';
import { tumbleWinContent } from './help_screen_content/TumbleWinContent';
import { localizationManager } from '../../../managers/LocalizationManager';
import { LOCALIZATION_DEFAULTS } from '../../../backend/LocalizationData';
import { CurrencyManager } from '../CurrencyManager';
import { formatCurrencyNumber } from '../../../utils/NumberPrecisionFormatter';

type TextStyle = Phaser.Types.GameObjects.Text.TextStyle;

type GameScene = Scene & {
    getCurrentBetAmount?: () => number;
};

interface HelpScreenStyles {
    titleStyle: TextStyle;
    header1Style: TextStyle;
    header2Style: TextStyle;
    content1Style: TextStyle;
    contentHeader1Style: TextStyle;
    textStyle: TextStyle;
}

/** Context passed when rendering content items inside a border (e.g. for Row vertical centering and grid alignment). */
interface ContentItemContext {
    borderRightEdge?: number;
    borderStartY?: number;
    borderPaddingTop?: number;
    borderPaddingBottom?: number;
}

export class HelpScreen {
    // ============================================================================
    // PROPERTIES (Non-ContentSection)
    // ============================================================================

    /** Default header style (used for section headers like "Game Rules"). */
    private static readonly defaultHeaderStyle: TextStyle = {
        fontSize: '24px',
        color: '#379557',
        fontFamily: 'Poppins-Bold',
        fontStyle: 'bold',
    };
    /** Default body text style (used for content text like descriptions). */
    private static readonly defaultBodyTextStyle: TextStyle = {
        fontSize: '20px',
        color: '#FFFFFF',
        fontFamily: 'Poppins-Regular',
        align: 'left',
    };
    /** Default outer border config: same style and padding as symbol payouts (16px padding, dark fill, white stroke). */
    private static readonly defaultOuterBorderStyle: BorderOpts = {
        padding: { top: 16, right: 16, bottom: 16, left: 16 },
        style: { fillColor: 0x1f1f1f, strokeColor: 0xffffff },
    };

    private static readonly defaultInnerBorderStyle: BorderOpts = {
        padding: { top: 20, bottom: 20, right: 20, left: 20 },
        style: { fillColor: 0xffffff, strokeColor: 0xffffff, fillAlpha: 0.1, strokeAlpha: 0.2 },
    };

    /** Line/divider color (e.g. LineBreak). */
    private static readonly LINE_DIVIDER_COLOR = 0x379557;
    /** Border fill color. */
    private static readonly BORDER_FILL_COLOR = 0x1f1f1f;
    /** Border stroke color. */
    private static readonly BORDER_STROKE_COLOR = 0xffffff;
    /** Border fill alpha. */
    private static readonly BORDER_FILL_ALPHA = 0.95;
    /** Border stroke alpha. */
    private static readonly BORDER_STROKE_ALPHA = 0.18;

    /** Wireframe hierarchy: root section. */
    private static readonly WIREFRAME_ROOT_COLOR = 0xff0000;
    private static readonly WIREFRAME_ROOT_WIDTH = 2;
    /** Wireframe hierarchy: child section. */
    private static readonly WIREFRAME_CHILD_COLOR = 0xffff00;
    private static readonly WIREFRAME_CHILD_WIDTH = 1;
    /** Wireframe hierarchy: element (header or content item). */
    private static readonly WIREFRAME_ELEMENT_COLOR = 0x00ff00;
    private static readonly WIREFRAME_ELEMENT_WIDTH = 0.5;
    /** Wireframe for grid cells (each text/cell in a grid). */
    private static readonly WIREFRAME_GRID_CELL_COLOR = 0xffffff;

    /** When true, draw root section wireframes (red). */
    private showRootWireframe: boolean = false;
    /** When true, draw child section wireframes (yellow). */
    private showChildWireframe: boolean = false;
    /** When true, draw element wireframes (green). */
    private showElementWireframe: boolean = false;

    /** Resolves help content text via localization, with fallback to LOCALIZATION_DEFAULTS. */
    private getHelpText(key: string): string {
        return localizationManager.getTextByKey(key) ?? LOCALIZATION_DEFAULTS[key] ?? key;
    }

    /** Returns display string for content that may have a localization key. */
    private resolveHelpText(key: string | undefined, value: string | undefined): string {
        if (key) return this.getHelpText(key);
        if (!value) return '';
        
        // Handle currency formatting markers (format: "CURRENCY:amount" or "text\nCURRENCY:amount")
        // Replace all occurrences of "CURRENCY:amount" with formatted currency
        // Use non-breaking space (\u00A0) to prevent currency and value from wrapping to separate lines
        const currencyMarkerRegex = /CURRENCY:([\d.]+)/g;
        const processedValue = value.replace(currencyMarkerRegex, (match, amountStr) => {
            const amount = parseFloat(amountStr);
            if (!isNaN(amount)) {
                const currencyPrefix = CurrencyManager.getCurrencyCode();
                const formatted = formatCurrencyNumber(amount);
                return currencyPrefix ? `${currencyPrefix}\u00A0${formatted}` : formatted;
            }
            return match; // Return original if parsing fails
        });
        
        return processedValue;
    }

    private readonly contentArea: GameObjects.Container;
    private readonly rulesContent: GameObjects.Container;
    private scrollView: GameObjects.Container;
    private contentContainer: GameObjects.Container;
    /** Containers for z-ordered wireframes: section (root/child) drawn first, then content, then element. */
    private sectionWireframesContainer!: GameObjects.Container;
    private mainContentContainer!: GameObjects.Container;
    private elementWireframesContainer!: GameObjects.Container;
    /** Count of root section wireframes added (for insert order: roots first, then children). */
    private rootSectionWireframeCount: number = 0;
    /** Cached total scrollable content height for scroll bounds. */
    private contentHeight: number = 0;
    private yPosition: number = 0;
    /** Y position where payout sections start (after maxWinContent) */
    private payoutSectionsStartY: number = 0;
    /** Y position where payout sections end (before lineBreakSection) */
    private payoutSectionsEndY: number = 0;

    private static readonly spacingBetweenSections: number = 50;
    /** Default line spacing used when opts.lineSpacing is not explicitly provided. */
    private readonly defaultLineSpacing: number = 7;
    private readonly menuTopPadding: number = 20;
    private readonly tabHeight: number = 61;
    private readonly isMenuVisible: () => boolean;
    private readonly getBetAmount: () => number;
    private tabInteractionBlocker?: Phaser.GameObjects.Zone;
    private tabInteractionHitArea?: Phaser.Geom.Rectangle;
    private isTabInteractionBlocked: boolean = false;

    /** Test property exercising the full ContentSection interface (Header, Border, Content with all item types). */
    /** ContentSection for testing RichText with inline TextImage (e.g. "This is the {symbol0} scatter symbol."). */
    private static readonly testRichTextContentSection: ContentSection = {
        Content: [
            {
                RichText: {
                    opts: { padding: 6, align: 0, anchor: { x: 0, y: 0.5 } },
                    parts: [
                        'This is the ',
                        { TextImage: { key: 'symbol0', opts: { scale: 0.3 } } },
                        ' scatter symbol. Sama mo na si bob the builder.',
                    ],
                },
            },
        ],
    };

    private static readonly lineBreakSection: ContentSection = {
        Content: [
            { LineBreak: { opts: { padding: { top: HelpScreen.spacingBetweenSections, bottom: HelpScreen.spacingBetweenSections, right: 0, left: 0 }, thickness: 1 } } },
        ],
    };

    // ============================================================================
    // CONSTRUCTOR AND MAIN METHODS
    // ============================================================================

    constructor(
        private readonly scene: GameScene,
        contentArea: GameObjects.Container,
        rulesContent: GameObjects.Container,
        _styles: HelpScreenStyles,
        isMenuVisible: () => boolean,
        getBetAmount?: () => number
    ) {
        this.contentArea = contentArea;
        this.rulesContent = rulesContent;
        this.isMenuVisible = isMenuVisible;
        this.getBetAmount = getBetAmount ?? (() => 1);
    }

    public build(): void {
        this.setupScrollableRulesContent(this.scene);
        this.createNewHelpScreenContent(this.scene, this.rulesContent);
        this.rulesContent.add(this.scrollView);
    }

    /**
     * Rebuilds only the payout sections (symbol and scatter payouts).
     * Much more efficient than full rebuild since only payout values change with bet amount.
     */
    public rebuildPayoutSections(): void {
        const currentBet = this.getBetAmount();
        console.log('[HelpScreen] rebuildPayoutSections() called, current bet amount:', currentBet);
        
        if (this.payoutSectionsStartY === 0 || this.payoutSectionsEndY === 0) {
            console.warn('[HelpScreen] Payout section positions not tracked, falling back to full rebuild');
            this.rebuild();
            return;
        }

        // Remove all game objects that fall within the payout sections Y range
        const objectsToRemove: Phaser.GameObjects.GameObject[] = [];
        this.mainContentContainer.list.forEach((obj: Phaser.GameObjects.GameObject) => {
            const objY = (obj as any).y ?? 0;
            // Check if object is within payout sections range (with some tolerance for borders/padding)
            if (objY >= this.payoutSectionsStartY - 20 && objY <= this.payoutSectionsEndY + 20) {
                objectsToRemove.push(obj);
            }
        });

        // Also check wireframes and borders
        this.sectionWireframesContainer.list.forEach((obj: Phaser.GameObjects.GameObject) => {
            const objY = (obj as any).y ?? 0;
            if (objY >= this.payoutSectionsStartY - 20 && objY <= this.payoutSectionsEndY + 20) {
                objectsToRemove.push(obj);
            }
        });

        this.elementWireframesContainer.list.forEach((obj: Phaser.GameObjects.GameObject) => {
            const objY = (obj as any).y ?? 0;
            if (objY >= this.payoutSectionsStartY - 20 && objY <= this.payoutSectionsEndY + 20) {
                objectsToRemove.push(obj);
            }
        });

        // Remove the objects
        objectsToRemove.forEach(obj => {
            if (obj.parentContainer) {
                obj.parentContainer.remove(obj, true);
            } else {
                obj.destroy(true);
            }
        });

        // Recreate payout sections
        const { symbolPayoutContent, scatterPayoutContent } = getPayoutContent({
            defaultOuterBorderStyle: HelpScreen.defaultOuterBorderStyle,
            getBetAmount: this.getBetAmount,
            getIsDemo: () => (this.scene as any).gameAPI?.getDemoState(),
        });

        let currentY = this.payoutSectionsStartY;
        currentY = this.createContentSection(symbolPayoutContent, currentY);
        currentY = this.createContentSection(scatterPayoutContent, currentY);
        const newPayoutSectionsEndY = currentY;
        const yOffset = newPayoutSectionsEndY - this.payoutSectionsEndY;
        this.payoutSectionsEndY = newPayoutSectionsEndY;

        // Adjust Y positions of everything after payout sections
        if (yOffset !== 0) {
            this.mainContentContainer.list.forEach((obj: Phaser.GameObjects.GameObject) => {
                const objY = (obj as any).y ?? 0;
                if (objY > this.payoutSectionsEndY) {
                    (obj as any).y += yOffset;
                }
            });
            this.sectionWireframesContainer.list.forEach((obj: Phaser.GameObjects.GameObject) => {
                const objY = (obj as any).y ?? 0;
                if (objY > this.payoutSectionsEndY) {
                    (obj as any).y += yOffset;
                }
            });
            this.elementWireframesContainer.list.forEach((obj: Phaser.GameObjects.GameObject) => {
                const objY = (obj as any).y ?? 0;
                if (objY > this.payoutSectionsEndY) {
                    (obj as any).y += yOffset;
                }
            });
        }

        // Update content height
        this.contentHeight += yOffset;
        this.yPosition += yOffset;

        console.log('[HelpScreen] rebuildPayoutSections() completed, new bet amount used:', this.getBetAmount());
    }

    /**
     * Rebuilds the entire help screen content, useful when bet amount changes.
     * Clears existing content and rebuilds with current bet amount.
     * Use rebuildPayoutSections() for better performance when only payouts change.
     */
    public rebuild(): void {
        const currentBet = this.getBetAmount();
        console.log('[HelpScreen] rebuild() called, current bet amount:', currentBet);
        
        // Remove scrollView from rulesContent if it exists (without destroying yet)
        if (this.scrollView && this.scrollView.parentContainer) {
            this.rulesContent.remove(this.scrollView, false);
        }

        // Destroy existing containers (destroying scrollView will destroy all children)
        if (this.scrollView) {
            this.scrollView.destroy(true);
            this.scrollView = undefined as any;
        }
        // These are children of scrollView, so they're already destroyed
        this.contentContainer = undefined as any;
        this.sectionWireframesContainer = undefined as any;
        this.mainContentContainer = undefined as any;
        this.elementWireframesContainer = undefined as any;

        // Reset state
        this.rootSectionWireframeCount = 0;
        this.yPosition = 0;
        this.contentHeight = 0;
        this.payoutSectionsStartY = 0;
        this.payoutSectionsEndY = 0;

        // Rebuild content
        this.setupScrollableRulesContent(this.scene);
        this.createNewHelpScreenContent(this.scene, this.rulesContent);
        this.rulesContent.add(this.scrollView);
        
        console.log('[HelpScreen] rebuild() completed, new bet amount used:', this.getBetAmount());
    }

    private createNewHelpScreenContent(_scene: GameScene, _contentArea: GameObjects.Container): void {
        let currentY = 0;
        this.rootSectionWireframeCount = 0;

        const { symbolPayoutContent, scatterPayoutContent } = getPayoutContent({
            defaultOuterBorderStyle: HelpScreen.defaultOuterBorderStyle,
            getBetAmount: this.getBetAmount,
            getIsDemo: () => (this.scene as any).gameAPI?.getDemoState(),
        });

        currentY = this.createContentSection(gameRulesContent, currentY);
        currentY += HelpScreen.spacingBetweenSections / 2;
        const gameApi = (this.scene as any).gameAPI;
        currentY = this.createContentSection(getRtpContent(gameApi), currentY);
        currentY += HelpScreen.spacingBetweenSections / 2;
        currentY = this.createContentSection(getMaxWinContent(gameApi), currentY);
        currentY += HelpScreen.spacingBetweenSections / 2;
        
        // Track payout sections Y positions for efficient rebuilding
        this.payoutSectionsStartY = currentY;
        currentY = this.createContentSection(symbolPayoutContent, currentY);
        currentY = this.createContentSection(scatterPayoutContent, currentY);
        this.payoutSectionsEndY = currentY;
        
        // add linebreak here
        currentY = this.createContentSection(HelpScreen.lineBreakSection, currentY);
        currentY = this.createContentSection(tumbleWinContent, currentY);
        currentY += HelpScreen.spacingBetweenSections;
        currentY = this.createContentSection(freeSpinContent, currentY);
        currentY += HelpScreen.spacingBetweenSections;
        currentY = this.createContentSection(gameSettingsContent, currentY);
        currentY += HelpScreen.spacingBetweenSections;
        currentY = this.createContentSection(howToPlayContent, currentY);

        this.yPosition = currentY;
        this.contentHeight = this.yPosition;
    }

    // ============================================================================
    // HELPER METHODS
    // ============================================================================

    /**
     * Dispatches a single content item to the appropriate creator; returns the Y position below it.
     * Always uses offset-aware creators so a single code path handles both bordered and non-bordered content.
     */
    private processContentItem(
        item: ContentItem,
        width: number,
        y: number,
        offsetX: number,
        context?: ContentItemContext
    ): number {
        if ('Header' in item && item.Header != null) {
            return this.createContentHeaderWithOffset(item.Header, width, y, offsetX);
        }
        if ('Image' in item && item.Image != null) {
            return this.createContentImageWithOffset(item.Image, width, y, offsetX);
        }
        if ('Text' in item && item.Text != null) {
            return this.createContentTextWithOffset(item.Text, width, y, offsetX);
        }
        if ('RichText' in item && item.RichText != null) {
            return this.createContentRichTextWithOffset(item.RichText, width, y, offsetX);
        }
        if ('LineBreak' in item && item.LineBreak != null) {
            return this.createContentLineBreakWithOffset(item.LineBreak, width, y, offsetX);
        }
        if ('Grid' in item && item.Grid != null) {
            return this.createContentGridWithOffset(item.Grid, width, y, offsetX, context?.borderRightEdge);
        }
        if ('Row' in item && item.Row != null) {
            return this.createContentRowWithOffset(
                item.Row,
                width,
                y,
                offsetX,
                context?.borderStartY,
                context?.borderPaddingTop,
                context?.borderPaddingBottom,
                context?.borderRightEdge
            );
        }
        if ('ChildSection' in item && item.ChildSection != null) {
            return this.createContentSection(item.ChildSection, y, offsetX, width, false);
        }
        return y;
    }

    /**
     * Builds a content section (header, border, content items) and returns the Y position
     * after the section (for stacking the next section).
     * Any part of contentSection (Header, Border, Content, or item fields) that is null/undefined is skipped.
     * Border encapsulates Content items but not Header. Header is always above the border.
     * @param offsetX Optional X offset for positioning (used when inside a border)
     * @param containerWidth Optional container width (defaults to full contentArea width)
     * @param isRoot If true, section is a root content section (wireframe red 2px); if false, child section (wireframe yellow 1px)
     */
    private createContentSection(contentSection: ContentSection, startY: number = 0, offsetX: number = 0, containerWidth?: number, isRoot: boolean = true): number {
        const sectionMarginTop = this.getMarginTop(contentSection.margin);
        let localY = startY + sectionMarginTop;
        const effectiveWidth = containerWidth ?? this.contentArea.width;

        if (contentSection.Header != null) {
            const headerStartY = localY;
            localY = this.createSectionHeaderWithOffset(contentSection.Header, effectiveWidth, localY, offsetX);
            this.drawElementWireframe(offsetX, headerStartY, effectiveWidth, localY - headerStartY);
        }

        // If Border exists, create it and render Content inside with padding
        if (contentSection.Border != null) {
            const borderMarginTop = this.getMarginTop(contentSection.Border.opts?.margin);
            const borderStartY = localY + borderMarginTop;
            const borderPadding = this.getBorderPadding(contentSection.Border.opts?.padding);

            // Create content inside border (with padding applied)
            // Content is offset by borderPadding.left and uses reduced width
            const contentStartY = borderStartY + borderPadding.top;
            const contentWidth = effectiveWidth - borderPadding.left - borderPadding.right;
            const contentOffsetX = offsetX + borderPadding.left;
            let contentEndY = contentStartY;

            if (contentSection.Content != null) {
                const borderRightEdge = contentOffsetX + contentWidth;
                const itemContext: ContentItemContext = {
                    borderRightEdge,
                    borderStartY,
                    borderPaddingTop: borderPadding.top,
                    borderPaddingBottom: borderPadding.bottom,
                };
                for (const item of contentSection.Content) {
                    const itemStartY = contentEndY;
                    contentEndY = this.processContentItem(item, contentWidth, contentEndY, contentOffsetX, itemContext);
                    this.drawElementWireframe(contentOffsetX, itemStartY, contentWidth, contentEndY - itemStartY);
                }
            }

            // Calculate border height based on content
            const borderHeight = contentEndY - borderStartY + borderPadding.bottom;

            // Create the border graphics (offset by offsetX if nested)
            const borderMarginBottom = this.getMarginBottom(contentSection.Border.opts?.margin);
            localY = this.createBorder(
                contentSection.Border,
                effectiveWidth,
                borderStartY,
                borderHeight,
                offsetX
            ) + borderMarginBottom;
        } else {
            if (contentSection.Content != null) {
                for (const item of contentSection.Content) {
                    const itemStartY = localY;
                    localY = this.processContentItem(item, effectiveWidth, localY, offsetX);
                    this.drawElementWireframe(offsetX, itemStartY, effectiveWidth, localY - itemStartY);
                }
            }
        }

        // Wireframe: draw section bounds (root = red 2px, child = yellow 1px); z-order: roots first, then children
        const sectionMarginBottom = this.getMarginBottom(contentSection.margin);
        const sectionEndY = localY + sectionMarginBottom;
        const drawSectionWireframe = isRoot ? this.showRootWireframe : this.showChildWireframe;
        if (drawSectionWireframe) {
            const sectionColor = isRoot ? HelpScreen.WIREFRAME_ROOT_COLOR : HelpScreen.WIREFRAME_CHILD_COLOR;
            const sectionWidth = isRoot ? HelpScreen.WIREFRAME_ROOT_WIDTH : HelpScreen.WIREFRAME_CHILD_WIDTH;
            const sectionWireframe = this.scene.add.graphics();
            sectionWireframe.lineStyle(sectionWidth, sectionColor, 1);
            sectionWireframe.strokeRect(offsetX, startY, effectiveWidth, sectionEndY - startY);
            if (isRoot) {
                this.sectionWireframesContainer.addAt(sectionWireframe, this.rootSectionWireframeCount++);
            } else {
                this.sectionWireframesContainer.add(sectionWireframe);
            }
        }

        return sectionEndY;
    }

    /**
     * Draws an element-level wireframe (green, 0.5px) around a region.
     * Used for section header and each content item; skipped if height <= 0.
     */
    private drawElementWireframe(x: number, y: number, width: number, height: number): void {
        if (!this.showElementWireframe || height <= 0) return;
        const g = this.scene.add.graphics();
        g.lineStyle(HelpScreen.WIREFRAME_ELEMENT_WIDTH, HelpScreen.WIREFRAME_ELEMENT_COLOR, 1);
        g.strokeRect(x, y, width, height);
        this.elementWireframesContainer.add(g);
    }

    /**
     * Draws a white wireframe around a grid cell (each text/image in a grid).
     */
    private drawGridCellWireframe(x: number, y: number, width: number, height: number): void {
        if (!this.showElementWireframe || height <= 0) return;
        const g = this.scene.add.graphics();
        g.lineStyle(HelpScreen.WIREFRAME_ELEMENT_WIDTH, HelpScreen.WIREFRAME_GRID_CELL_COLOR, 1);
        g.strokeRect(x, y, width, height);
        this.elementWireframesContainer.add(g);
    }

    /**
     * Creates and positions the section header text; returns the Y position below the header.
     */
    private createSectionHeader(
        header: NonNullable<ContentSection['Header']>,
        containerWidth: number,
        startY: number
    ): number {
        return this.createSectionHeaderWithOffset(header, containerWidth, startY, 0);
    }

    /**
     * Creates and positions the section header text with X offset; returns the Y position below the header.
     */
    private createSectionHeaderWithOffset(
        header: NonNullable<ContentSection['Header']>,
        containerWidth: number,
        startY: number,
        offsetX: number
    ): number {
        const opts = header.opts ?? {};
        const marginTop = this.getMarginTop(opts.margin);
        const marginBottom = this.getMarginBottom(opts.margin);
        const paddingTop = this.getPaddingTop(opts.padding);
        const paddingBottom = this.getPaddingBottom(opts.padding);
        const paddingLeft = this.getPaddingLeft(opts.padding);
        const paddingRight = this.getPaddingRight(opts.padding);
        const effectiveStartY = startY + marginTop;
        const align = typeof opts.align === 'number' ? opts.align : 0;
        const anchorObj = opts.anchor != null && typeof opts.anchor === 'object' ? opts.anchor : undefined;
        const anchorX = anchorObj?.x ?? 0;
        const anchorY = anchorObj?.y ?? 0;
        const offsetXFromOpts = opts.offset?.x ?? 0;
        const offsetY = opts.offset?.y ?? 0;
        // Use default style if style is null/undefined or doesn't have a color property
        const providedStyle = opts.style as TextStyle | undefined;
        const baseStyle = providedStyle != null && 'color' in providedStyle
            ? providedStyle
            : HelpScreen.defaultHeaderStyle;
        const styleWithSpacing = this.applyLineSpacing(baseStyle, opts.lineSpacing);
        const availableWidth = containerWidth - paddingLeft - paddingRight;
        const style = this.getTextStyleWithWordWrap(styleWithSpacing, availableWidth);

        const displayText = this.resolveHelpText(header.key, header.value);
        const text = this.scene.add.text(0, 0, displayText, style);
        text.setOrigin(anchorX, anchorY);
        const x = offsetX + paddingLeft + availableWidth * align + offsetXFromOpts;
        const y = effectiveStartY + paddingTop + offsetY;
        text.setPosition(x, y);
        this.mainContentContainer.add(text);

        return y + text.height + paddingBottom + marginBottom;
    }

    /**
     * Creates a Header content item; returns the Y position below it.
     */
    private createContentHeader(
        header: { opts?: HeaderOpts; value?: string; key?: string },
        containerWidth: number,
        startY: number
    ): number {
        return this.createContentHeaderWithOffset(header, containerWidth, startY, 0);
    }

    /**
     * Applies sizing to an image based on the size option.
     */
    private applyImageSizing(
        img: Phaser.GameObjects.Image,
        size: 'native' | 'fitToWidth' | 'fitToHeight' | undefined,
        containerWidth: number,
        maxHeight?: number
    ): void {
        if (!size || size === 'native') {
            return; // Use native size
        }

        const nativeWidth = img.width;
        const nativeHeight = img.height;

        if (size === 'fitToWidth') {
            // Scale to fit container width while maintaining aspect ratio
            const scale = containerWidth / nativeWidth;
            img.setScale(scale);
        } else if (size === 'fitToHeight') {
            // Scale to fit maxHeight while maintaining aspect ratio
            if (maxHeight == null) {
                console.warn('[HelpScreen] fitToHeight requires maxHeight option. Using native size.');
                return;
            }
            const scale = maxHeight / nativeHeight;
            img.setScale(scale);
        }
    }

    /**
     * Applies ImageOpts.scale multiplier (default 1). Call after applyImageSizing.
     */
    private applyImageOptsScale(img: Phaser.GameObjects.Image, opts?: ImageOpts): void {
        const scale = opts?.scale ?? 1;
        if (scale !== 1) {
            img.setScale(img.scaleX * scale, img.scaleY * scale);
        }
    }

    /**
     * Creates an Image content item; returns the Y position below it.
     */
    private createContentImage(
        image: { opts?: ImageOpts; key?: string; src?: string },
        containerWidth: number,
        startY: number
    ): number {
        return this.createContentImageWithOffset(image, containerWidth, startY, 0);
    }

    /**
     * Creates a Text content item; returns the Y position below it.
     */
    private createContentText(
        text: { opts?: TextOpts; value?: string },
        containerWidth: number,
        startY: number
    ): number {
        return this.createContentTextWithOffset(text, containerWidth, startY, 0);
    }

    /**
     * Creates a LineBreak content item; returns the Y position below it.
     * Uses graphics with fillRect, matching HelpScreen_OLD.ts implementation.
     */
    private createContentLineBreak(
        lineBreak: { opts?: LineBreakOpts },
        containerWidth: number,
        startY: number
    ): number {
        return this.createContentLineBreakWithOffset(lineBreak, containerWidth, startY, 0);
    }

    /**
     * Merges a default text style with an optional override style.
     * Override properties take precedence over defaults.
     */
    private mergeTextStyle(defaultStyle: TextStyle, overrideStyle?: Record<string, unknown>): TextStyle {
        if (!overrideStyle) {
            return { ...defaultStyle };
        }
        return {
            ...defaultStyle,
            ...overrideStyle,
        } as TextStyle;
    }

    /** Resolves final line spacing: opts.lineSpacing > style.lineSpacing > defaultLineSpacing. */
    private resolveLineSpacing(lineSpacing: number | undefined, style?: TextStyle): number {
        const styleLineSpacing = style?.lineSpacing;
        return lineSpacing ?? (typeof styleLineSpacing === 'number' ? styleLineSpacing : this.defaultLineSpacing);
    }

    /**
     * Applies resolved lineSpacing into the style (for wrapped text line distance).
     */
    private applyLineSpacing(style: TextStyle, lineSpacing: number | undefined): TextStyle {
        return { ...style, lineSpacing: this.resolveLineSpacing(lineSpacing, style) };
    }

    /**
     * Returns a text style with word wrap enabled at the given width.
     * Uses useAdvancedWrap: true so CJK text (no spaces) wraps by character; space-separated languages unchanged.
     * Merges with the provided style so existing properties are preserved.
     */
    private getTextStyleWithWordWrap(style: TextStyle, wrapWidth: number): TextStyle {
        return {
            ...style,
            wordWrap: {
                width: wrapWidth,
                useAdvancedWrap: true,
                ...(typeof style.wordWrap === 'object' && style.wordWrap != null ? style.wordWrap : {}),
            },
        };
    }

    /** Parses a fontSize value from TextStyle into a numeric pixel size, or null if unavailable. */
    private parseFontSize(fontSize: string | number | undefined): number | null {
        if (typeof fontSize === 'number' && Number.isFinite(fontSize) && fontSize > 0) {
            return fontSize;
        }
        if (typeof fontSize === 'string') {
            const parsed = parseFloat(fontSize);
            if (Number.isFinite(parsed) && parsed > 0) {
                return parsed;
            }
        }
        return null;
    }

    /** Returns a new TextStyle with the provided font size (in pixels). */
    private withFontSize(style: TextStyle, size: number): TextStyle {
        return {
            ...style,
            fontSize: `${size}px`,
        };
    }

    /**
     * Creates a Phaser text object for a single-line string, shrinking font size down until it fits
     * within maxWidth (no wrapping). If it cannot fit even at minFontSize, returns text at minFontSize
     * and reports fitsWithinWidth: false (caller may still render it and allow overflow/clipping).
     */
    private createSingleLineFittedText(
        displayText: string,
        textStyle: TextStyle,
        maxWidth: number,
        minFontSizeInput?: number
    ): { text: Phaser.GameObjects.Text; width: number; height: number; fitsWithinWidth: boolean } {
        const styleWithoutWrap: TextStyle = { ...textStyle };
        delete styleWithoutWrap.wordWrap;

        const minFontSize =
            typeof minFontSizeInput === 'number' && Number.isFinite(minFontSizeInput) && minFontSizeInput > 0
                ? Math.floor(minFontSizeInput)
                : 12;

        const initialTextObj = this.scene.add.text(0, 0, displayText, styleWithoutWrap);
        const initialFontSize = this.parseFontSize(styleWithoutWrap.fontSize as string | number | undefined);

        if (maxWidth > 0 && initialTextObj.width <= maxWidth) {
            return {
                text: initialTextObj,
                width: initialTextObj.width,
                height: initialTextObj.height,
                fitsWithinWidth: true,
            };
        }

        if (initialFontSize == null || initialFontSize <= minFontSize) {
            return {
                text: initialTextObj,
                width: initialTextObj.width,
                height: initialTextObj.height,
                fitsWithinWidth: maxWidth > 0 ? initialTextObj.width <= maxWidth : false,
            };
        }

        initialTextObj.destroy();

        const maxSize = Math.floor(initialFontSize);
        const minSize = Math.min(minFontSize, maxSize);
        let low = minSize;
        let high = maxSize;
        let bestFittingSize: number | null = null;

        while (low <= high) {
            const candidateSize = Math.floor((low + high) / 2);
            const candidateObj = this.scene.add.text(
                0,
                0,
                displayText,
                this.withFontSize(styleWithoutWrap, candidateSize)
            );
            const candidateFits = maxWidth > 0 && candidateObj.width <= maxWidth;
            candidateObj.destroy();

            if (candidateFits) {
                bestFittingSize = candidateSize;
                low = candidateSize + 1;
            } else {
                high = candidateSize - 1;
            }
        }

        const finalSize = bestFittingSize ?? minSize;
        const finalObj = this.scene.add.text(
            0,
            0,
            displayText,
            this.withFontSize(styleWithoutWrap, finalSize)
        );

        return {
            text: finalObj,
            width: finalObj.width,
            height: finalObj.height,
            fitsWithinWidth: maxWidth > 0 ? finalObj.width <= maxWidth : false,
        };
    }

    /**
     * Creates a Text that scales down to fit within the given bounds.
     * Bounds are determined by container dimensions and padding; the text's own style/opts are applied.
     * Returns the Phaser Text object (not yet added to container).
     */
    private createTextFittingBounds(
        displayText: string,
        boundsWidth: number,
        boundsHeight: number,
        baseStyle: TextStyle,
        textOpts: TextOpts
    ): Phaser.GameObjects.Text {
        const styleWithSpacing = this.applyLineSpacing(baseStyle, textOpts.lineSpacing);
        const style = { ...styleWithSpacing };
        delete style.wordWrap;
        const textObj = this.scene.add.text(0, 0, displayText, style);
        if (textOpts.rtl === true) {
            textObj.setRTL(true);
        }
        const w = textObj.width;
        const h = textObj.height;
        if (boundsWidth > 0 && boundsHeight > 0 && w > 0 && h > 0 && (w > boundsWidth || h > boundsHeight)) {
            const scaleX = boundsWidth / w;
            const scaleY = boundsHeight / h;
            textObj.setScale(Math.min(1, scaleX, scaleY));
        }
        return textObj;
    }

    /**
     * Creates a border graphics object and returns the Y position below it.
     */
    private createBorder(
        border: NonNullable<ContentSection['Border']>,
        containerWidth: number,
        startY: number,
        height: number,
        offsetX: number = 0
    ): number {
        const opts = border.opts ?? {};
        const style = opts.style ?? {};
        const fillColor = (style.fillColor as number | undefined) ?? HelpScreen.BORDER_FILL_COLOR;
        const strokeColor = (style.strokeColor as number | undefined) ?? HelpScreen.BORDER_STROKE_COLOR;
        const fillAlpha = (style.fillAlpha as number | undefined) ?? HelpScreen.BORDER_FILL_ALPHA;
        const strokeAlpha = (style.strokeAlpha as number | undefined) ?? HelpScreen.BORDER_STROKE_ALPHA;
        const borderRadius = opts.borderRadius ?? 8;

        const borderGraphics = this.scene.add.graphics();
        borderGraphics.fillStyle(fillColor, fillAlpha);
        borderGraphics.fillRoundedRect(offsetX, startY, containerWidth, height, borderRadius);
        borderGraphics.lineStyle(1.5, strokeColor, strokeAlpha);
        borderGraphics.strokeRoundedRect(offsetX, startY, containerWidth, height, borderRadius);

        this.mainContentContainer.add(borderGraphics);
        this.mainContentContainer.sendToBack(borderGraphics);

        return startY + height;
    }

    /**
     * Gets border padding as an object with top, right, bottom, left values.
     */
    private getBorderPadding(padding: number | { top?: number; right?: number; bottom?: number; left?: number } | undefined): {
        top: number;
        right: number;
        bottom: number;
        left: number;
    } {
        if (padding === undefined) {
            return { top: 0, right: 0, bottom: 0, left: 0 };
        }
        if (typeof padding === 'number') {
            return { top: padding, right: padding, bottom: padding, left: padding };
        }
        return {
            top: padding.top ?? 0,
            right: padding.right ?? 0,
            bottom: padding.bottom ?? 0,
            left: padding.left ?? 0,
        };
    }

    /**
     * Creates a Header content item with X offset (for border content); returns the Y position below it.
     */
    private createContentHeaderWithOffset(
        header: { opts?: HeaderOpts; value?: string; key?: string },
        containerWidth: number,
        startY: number,
        offsetX: number
    ): number {
        const opts = header.opts ?? {};
        const marginTop = this.getMarginTop(opts.margin);
        const marginBottom = this.getMarginBottom(opts.margin);
        const paddingTop = this.getPaddingTop(opts.padding);
        const paddingBottom = this.getPaddingBottom(opts.padding);
        const paddingLeft = this.getPaddingLeft(opts.padding);
        const paddingRight = this.getPaddingRight(opts.padding);
        const effectiveStartY = startY + marginTop;
        const align = typeof opts.align === 'number' ? opts.align : 0;
        const anchorObj = opts.anchor != null && typeof opts.anchor === 'object' ? opts.anchor : undefined;
        const anchorX = anchorObj?.x ?? 0;
        const anchorY = anchorObj?.y ?? 0;
        const offsetXFromOpts = opts.offset?.x ?? 0;
        const offsetY = opts.offset?.y ?? 0;
        const providedStyle = opts.style as TextStyle | undefined;
        const baseStyle = providedStyle != null && 'color' in providedStyle
            ? providedStyle
            : HelpScreen.defaultHeaderStyle;
        // For word wrap, use available width after accounting for left/right padding
        const availableWidth = containerWidth - paddingLeft - paddingRight;
        const styleWithSpacing = this.applyLineSpacing(baseStyle, opts.lineSpacing);
        const style = this.getTextStyleWithWordWrap(styleWithSpacing, availableWidth);

        const displayText = this.resolveHelpText(header.key, header.value);
        const text = this.scene.add.text(0, 0, displayText, style);
        text.setOrigin(anchorX, anchorY);
        // Position header accounting for left padding and alignment
        const x = offsetX + paddingLeft + availableWidth * align + offsetXFromOpts;
        const y = effectiveStartY + paddingTop + offsetY;
        text.setPosition(x, y);
        this.mainContentContainer.add(text);

        return y + text.height + paddingBottom + marginBottom;
    }

    /**
     * Creates an Image content item with X offset (for border content); returns the Y position below it.
     */
    private createContentImageWithOffset(
        image: { opts?: ImageOpts; key?: string; src?: string },
        containerWidth: number,
        startY: number,
        offsetX: number
    ): number {
        const opts = image.opts ?? {};
        const marginTop = this.getMarginTop(opts.margin);
        const marginBottom = this.getMarginBottom(opts.margin);
        const paddingTop = this.getPaddingTop(opts.padding);
        const paddingBottom = this.getPaddingBottom(opts.padding);
        const paddingLeft = this.getPaddingLeft(opts.padding);
        const paddingRight = this.getPaddingRight(opts.padding);
        const effectiveStartY = startY + marginTop;
        const align = typeof opts.align === 'number' ? opts.align : 0;
        const anchorObj = opts.anchor != null && typeof opts.anchor === 'object' ? opts.anchor : undefined;
        const anchorX = anchorObj?.x ?? 0;
        const anchorY = anchorObj?.y ?? 0;
        const offsetXFromOpts = opts.offset?.x ?? 0;
        const offsetY = opts.offset?.y ?? 0;

        const imageKey = image.key ?? image.src;
        if (imageKey == null) {
            return startY + marginTop + marginBottom;
        }

        const img = this.scene.add.image(0, 0, imageKey);
        const imageSize = opts.size ?? 'native';
        // For fitToWidth, use available width after accounting for left/right padding
        const availableWidth = containerWidth - paddingLeft - paddingRight;
        const sizingWidth = imageSize === 'fitToWidth' ? availableWidth : containerWidth;
        this.applyImageSizing(img, imageSize, sizingWidth, opts.maxHeight);
        const scaleAffectsLayout = opts.scaleAffectsLayout ?? true;

        // Calculate layout dimensions BEFORE applying scale if scale doesn't affect layout
        const layoutHeight = scaleAffectsLayout ? img.displayHeight : img.displayHeight;
        let finalLayoutHeight: number;
        if (!scaleAffectsLayout) {
            // Store layout dimensions before scale
            finalLayoutHeight = img.displayHeight;
            // Apply visual scale AFTER layout calculations (doesn't affect layout)
            this.applyImageOptsScale(img, opts);
        } else {
            // Scale affects layout (default behavior)
            this.applyImageOptsScale(img, opts);
            finalLayoutHeight = img.displayHeight;
        }

        img.setOrigin(anchorX, anchorY);
        // Position image accounting for left padding and alignment
        const x = offsetX + paddingLeft + availableWidth * align + offsetXFromOpts;
        const y = effectiveStartY + paddingTop + offsetY;
        img.setPosition(x, y);
        this.mainContentContainer.add(img);

        return y + finalLayoutHeight + paddingBottom + marginBottom;
    }

    /**
     * Creates a Text content item with X offset (for border content); returns the Y position below it.
     */
    private createContentTextWithOffset(
        text: { opts?: TextOpts; value?: string; key?: string },
        containerWidth: number,
        startY: number,
        offsetX: number
    ): number {
        const opts = text.opts ?? {};
        const marginTop = this.getMarginTop(opts.margin);
        const marginBottom = this.getMarginBottom(opts.margin);
        const paddingTop = this.getPaddingTop(opts.padding);
        const paddingBottom = this.getPaddingBottom(opts.padding);
        const paddingLeft = this.getPaddingLeft(opts.padding);
        const paddingRight = this.getPaddingRight(opts.padding);
        const effectiveStartY = startY + marginTop;
        const align = typeof opts.align === 'number' ? opts.align : 0;
        const anchorObj = opts.anchor != null && typeof opts.anchor === 'object' ? opts.anchor : undefined;
        const anchorX = anchorObj?.x ?? 0;
        const anchorY = anchorObj?.y ?? 0;
        const offsetXFromOpts = opts.offset?.x ?? 0;
        const offsetY = opts.offset?.y ?? 0;

        const baseStyle = this.mergeTextStyle(HelpScreen.defaultBodyTextStyle, opts.style as Record<string, unknown>);
        const availableWidth = containerWidth - paddingLeft - paddingRight;
        const displayText = this.resolveHelpText(text.key, text.value);

        const isRTL = opts.rtl === true;
        const useFitToSingleLine = opts.fitToSingleLine === true;

        let textObj: Phaser.GameObjects.Text;

        if (useFitToSingleLine) {
            const styleWithSpacing = this.applyLineSpacing(baseStyle, opts.lineSpacing);
            const { text: fittedText } = this.createSingleLineFittedText(
                displayText,
                styleWithSpacing,
                availableWidth,
                opts.minFontSize
            );
            textObj = fittedText;
        } else {
            const styleWithSpacing = this.applyLineSpacing(baseStyle, opts.lineSpacing);
            const style = this.getTextStyleWithWordWrap(styleWithSpacing, availableWidth);

            if (isRTL) {
                (style as any).rtl = true;
            }

            textObj = this.scene.add.text(0, 0, displayText, style);
        }

        if (isRTL) {
            textObj.setRTL(true);
        }
        
        textObj.setOrigin(anchorX, anchorY);
        // Position text accounting for left padding and alignment
        const x = offsetX + paddingLeft + availableWidth * align + offsetXFromOpts;
        const y = effectiveStartY + paddingTop + offsetY;
        textObj.setPosition(x, y);
        this.mainContentContainer.add(textObj);

        return y + textObj.height + paddingBottom + marginBottom;
    }

    /**
     * Creates a RichText content item (text and inline TextImage parts) with X offset; returns the Y position below it.
     */
    private createContentRichTextWithOffset(
        richText: { opts?: TextOpts; parts: RichTextPart[]; placeholderImageOpts?: Record<string, ImageOpts>; placeholderImages?: Record<string, RichTextPlaceholderImage> },
        containerWidth: number,
        startY: number,
        offsetX: number
    ): number {
        const opts = richText.opts ?? {};
        const marginTop = this.getMarginTop(opts.margin);
        const marginBottom = this.getMarginBottom(opts.margin);
        const paddingTop = this.getPaddingTop(opts.padding);
        const paddingBottom = this.getPaddingBottom(opts.padding);
        const paddingLeft = this.getPaddingLeft(opts.padding);
        const paddingRight = this.getPaddingRight(opts.padding);
        const effectiveStartY = startY + marginTop;
        const align = typeof opts.align === 'number' ? opts.align : 0;
        const anchorObj = opts.anchor != null && typeof opts.anchor === 'object' ? opts.anchor : undefined;
        const anchorX = anchorObj?.x ?? 0;
        const anchorY = anchorObj?.y ?? 0;
        const offsetXFromOpts = opts.offset?.x ?? 0;
        const offsetY = opts.offset?.y ?? 0;

        // For line wrapping, use available width after accounting for left/right padding
        const availableWidth = containerWidth - paddingLeft - paddingRight;
        const baseStyle = HelpScreen.defaultBodyTextStyle;
        const placeholderImageOpts = richText.placeholderImageOpts ?? {};
        const placeholderImages = richText.placeholderImages ?? {};
        const placeholderImageUsageCounter: Record<string, number> = {};
        const placeholderTokenRegex = /^\{([A-Za-z0-9_.-]+)\}$/;

        type Segment = {
            obj: Phaser.GameObjects.Text | Phaser.GameObjects.Image;
            width: number;
            height: number;
            anchorX?: number;
            anchorY?: number;
            // Padding and image dimensions for TextImage segments
            imagePaddingLeft?: number;
            imagePaddingRight?: number;
            imagePaddingTop?: number;
            imagePaddingBottom?: number;
            imageWidth?: number;
            imageHeight?: number;
            // Optional text overlay for TextImage segments
            textOverlay?: Phaser.GameObjects.Text;
            textAlign?: 'left' | 'right' | 'center';
        };
        type Line = Segment[];

        // Build lines by wrapping on word boundaries; wrapped lines start at the same X
        const lines: Line[] = [];
        let currentLine: Segment[] = [];
        let currentLineWidth = 0;

        const flushLine = (): void => {
            if (currentLine.length > 0) {
                lines.push(currentLine);
                currentLine = [];
                currentLineWidth = 0;
            }
        };

        const addTextToken = (token: string, textStyle: TextStyle): void => {
            const isWhitespace = /^\s+$/.test(token);
            if (isWhitespace && currentLineWidth === 0) {
                return;
            }

            const textObj = this.scene.add.text(0, 0, token, textStyle);
            const tokenWidth = textObj.width;
            const tokenHeight = textObj.height;

            // When a single token is wider than the line (e.g. long CJK text with no spaces),
            // break it using Phaser's word wrap so it wraps by width instead of staying one line.
            if (tokenWidth > availableWidth) {
                textObj.destroy();
                const getWrappedLines = (value: string, width: number): string[] => {
                    const wrapStyle: TextStyle = {
                        ...textStyle,
                        wordWrap: { width, useAdvancedWrap: true },
                    };
                    const tempText = this.scene.add.text(0, 0, value, wrapStyle);
                    const wrappedLines = tempText.getWrappedText(value);
                    tempText.destroy();
                    return wrappedLines;
                };

                if (currentLineWidth > 0) {
                    const remainingWidth = availableWidth - currentLineWidth;
                    const minRemainingWidthForInlineWrap = Math.max(80, availableWidth * 0.35);

                    // If enough width remains, allow the first wrapped slice to continue on
                    // the current line (important for inline placeholder images).
                    if (remainingWidth >= minRemainingWidthForInlineWrap) {
                        const firstPassLines = getWrappedLines(token, remainingWidth);
                        const firstLine = firstPassLines[0] ?? '';
                        if (firstLine.length > 0) {
                            const firstLineObj = this.scene.add.text(0, 0, firstLine, textStyle);
                            currentLine.push({
                                obj: firstLineObj,
                                width: firstLineObj.width,
                                height: firstLineObj.height,
                            });
                            currentLineWidth += firstLineObj.width;

                            const remainingToken = token.slice(firstLine.length);
                            if (remainingToken.length === 0) {
                                return;
                            }

                            flushLine();
                            const remainingLines = getWrappedLines(remainingToken, availableWidth);
                            for (let i = 0; i < remainingLines.length; i += 1) {
                                if (i > 0) {
                                    flushLine();
                                }
                                const lineText = remainingLines[i];
                                const lineObj = this.scene.add.text(0, 0, lineText, textStyle);
                                currentLine.push({
                                    obj: lineObj,
                                    width: lineObj.width,
                                    height: lineObj.height,
                                });
                                currentLineWidth += lineObj.width;
                            }
                            return;
                        }
                    }

                    // If little width remains, start on a fresh line to avoid tiny fragments.
                    flushLine();
                }

                const wrappedLines = getWrappedLines(token, availableWidth);
                for (let i = 0; i < wrappedLines.length; i += 1) {
                    if (i > 0) {
                        flushLine();
                    }
                    const lineText = wrappedLines[i];
                    const lineObj = this.scene.add.text(0, 0, lineText, textStyle);
                    currentLine.push({
                        obj: lineObj,
                        width: lineObj.width,
                        height: lineObj.height,
                    });
                    currentLineWidth += lineObj.width;
                }
                return;
            }

            if (currentLineWidth + tokenWidth > availableWidth && currentLineWidth > 0) {
                flushLine();
                if (isWhitespace) {
                    textObj.destroy();
                    return;
                }
            }

            currentLine.push({
                obj: textObj,
                width: tokenWidth,
                height: tokenHeight,
            });
            currentLineWidth += tokenWidth;
        };

        const addImageSegment = (
            imageKey: string,
            imageOpts: ImageOpts,
            imageText?: { value: string; style?: Record<string, unknown>; align?: 'left' | 'right' | 'center'; key?: string }
        ): void => {
            if (!this.scene.textures.exists(imageKey)) {
                return;
            }

            const img = this.scene.add.image(0, 0, imageKey);

            // Extract padding values
            const imagePaddingTop = this.getPaddingTop(imageOpts.padding);
            const imagePaddingBottom = this.getPaddingBottom(imageOpts.padding);
            const imagePaddingLeft = this.getPaddingLeft(imageOpts.padding);
            const imagePaddingRight = this.getPaddingRight(imageOpts.padding);

            const imageSize = imageOpts.size ?? 'native';
            // For fitToWidth, use available width after accounting for left/right padding
            const imageSizingWidth = imageSize === 'fitToWidth' ? availableWidth : containerWidth;
            this.applyImageSizing(img, imageSize, imageSizingWidth, imageOpts.maxHeight);
            const scaleAffectsLayout = imageOpts.scaleAffectsLayout ?? true;

            // Calculate layout dimensions BEFORE applying scale if scale doesn't affect layout
            let imgWidth: number;
            let imgHeight: number;
            if (!scaleAffectsLayout) {
                imgWidth = img.displayWidth;
                imgHeight = img.displayHeight;
                // Apply visual scale AFTER layout calculations (doesn't affect layout)
                this.applyImageOptsScale(img, imageOpts);
            } else {
                // Scale affects layout (default behavior)
                this.applyImageOptsScale(img, imageOpts);
                imgWidth = img.displayWidth;
                imgHeight = img.displayHeight;
            }

            const imgAnchorX = (imageOpts.anchor != null && typeof imageOpts.anchor === 'object' ? imageOpts.anchor.x : undefined) ?? 0.5;
            const imgAnchorY = (imageOpts.anchor != null && typeof imageOpts.anchor === 'object' ? imageOpts.anchor.y : undefined) ?? 0.5;
            img.setOrigin(imgAnchorX, imgAnchorY);

            // Total width and height including padding
            const totalImgWidth = imgWidth + imagePaddingLeft + imagePaddingRight;
            const totalImgHeight = imgHeight + imagePaddingTop + imagePaddingBottom;

            if (currentLineWidth + totalImgWidth > availableWidth && currentLineWidth > 0) {
                flushLine();
            }

            // Create text overlay if text is provided
            let textOverlay: Phaser.GameObjects.Text | undefined;
            let textAlign: 'left' | 'right' | 'center' = 'center';
            if (imageText != null) {
                textAlign = imageText.align ?? 'center';

                // Merge styles and add alignment for multi-line text
                const mergedStyle = imageText.style != null
                    ? this.mergeTextStyle(baseStyle, imageText.style)
                    : baseStyle;

                // Add align property to style for proper multi-line text alignment
                const textStyle = { ...mergedStyle, align: textAlign };

                const textOverlayValue = this.resolveHelpText(imageText.key, imageText.value);
                textOverlay = this.scene.add.text(0, 0, textOverlayValue, textStyle);

                // Set origin based on alignment
                if (textAlign === 'left') {
                    textOverlay.setOrigin(0, 0.5); // Left-aligned, vertically centered
                } else if (textAlign === 'right') {
                    textOverlay.setOrigin(1, 0.5); // Right-aligned, vertically centered
                } else {
                    textOverlay.setOrigin(0.5, 0.5); // Center-anchored (both X and Y)
                }
            }

            currentLine.push({
                obj: img,
                width: totalImgWidth,
                height: totalImgHeight,
                anchorX: imgAnchorX,
                anchorY: imgAnchorY,
                imagePaddingLeft,
                imagePaddingRight,
                imagePaddingTop,
                imagePaddingBottom,
                imageWidth: imgWidth,
                imageHeight: imgHeight,
                textOverlay,
                textAlign,
            });
            currentLineWidth += totalImgWidth;
        };

        const resolvePlaceholderImageSpec = (
            placeholderKey: string
        ): { key: string; opts: ImageOpts; text?: { value: string; style?: Record<string, unknown>; align?: 'left' | 'right' | 'center'; key?: string } } | null => {
            const explicitSpec = placeholderImages[placeholderKey];
            if (explicitSpec != null) {
                if (Array.isArray(explicitSpec)) {
                    if (explicitSpec.length === 0) {
                        return null;
                    }
                    const usageIndex = placeholderImageUsageCounter[placeholderKey] ?? 0;
                    const selectedSpec = explicitSpec[Math.min(usageIndex, explicitSpec.length - 1)];
                    placeholderImageUsageCounter[placeholderKey] = usageIndex + 1;
                    return {
                        key: selectedSpec.key,
                        opts: selectedSpec.opts ?? placeholderImageOpts[placeholderKey] ?? {},
                        text: selectedSpec.text,
                    };
                }
                return {
                    key: explicitSpec.key,
                    opts: explicitSpec.opts ?? placeholderImageOpts[placeholderKey] ?? {},
                    text: explicitSpec.text,
                };
            }

            if (this.scene.textures.exists(placeholderKey)) {
                return {
                    key: placeholderKey,
                    opts: placeholderImageOpts[placeholderKey] ?? {},
                };
            }

            return null;
        };

        const addTextWithInlineImagePlaceholders = (rawText: string, textStyle: TextStyle): void => {
            const tokens = rawText.split(/(\{[A-Za-z0-9_.-]+\}|\s+)/).filter((token) => token.length > 0);
            for (const token of tokens) {
                if (/^\s+$/.test(token)) {
                    const remainingWhitespace = token.replace(/\n/g, '');
                    if (remainingWhitespace.length > 0) {
                        addTextToken(remainingWhitespace, textStyle);
                    }

                    const lineBreakCount = (token.match(/\n/g) ?? []).length;
                    for (let i = 0; i < lineBreakCount; i += 1) {
                        flushLine();
                    }
                    continue;
                }

                const placeholderMatch = token.match(placeholderTokenRegex);
                if (placeholderMatch) {
                    const placeholderKey = placeholderMatch[1];
                    const imageSpec = resolvePlaceholderImageSpec(placeholderKey);
                    if (imageSpec != null && this.scene.textures.exists(imageSpec.key)) {
                        addImageSegment(imageSpec.key, imageSpec.opts, imageSpec.text);
                    } else {
                        // Fallback to literal token when texture key is unavailable.
                        addTextToken(token, textStyle);
                    }
                    continue;
                }

                addTextToken(token, textStyle);
            }
        };

        for (const part of richText.parts) {
            if (typeof part === 'string') {
                addTextWithInlineImagePlaceholders(part, baseStyle);
            } else if (part && 'Text' in part && part.Text != null) {
                // Styled text run
                const textRun = part.Text;
                const textStyle = textRun.style != null 
                    ? this.mergeTextStyle(baseStyle, textRun.style)
                    : baseStyle;
                const displayValue = this.resolveHelpText(textRun.key, textRun.value);
                const hasPlaceholderToken = /\{[A-Za-z0-9_.-]+\}/.test(displayValue);

                if (textRun.fitToSingleLine === true && !hasPlaceholderToken) {
                    const remainingWidth = availableWidth - currentLineWidth;
                    const firstPassMaxWidth = currentLineWidth > 0 ? remainingWidth : availableWidth;
                    const firstPassResult = this.createSingleLineFittedText(
                        displayValue,
                        textStyle,
                        firstPassMaxWidth,
                        textRun.minFontSize
                    );

                    if (currentLineWidth > 0 && !firstPassResult.fitsWithinWidth) {
                        firstPassResult.text.destroy();
                        flushLine();
                        const secondPassResult = this.createSingleLineFittedText(
                            displayValue,
                            textStyle,
                            availableWidth,
                            textRun.minFontSize
                        );
                        currentLine.push({
                            obj: secondPassResult.text,
                            width: secondPassResult.width,
                            height: secondPassResult.height,
                        });
                        currentLineWidth += secondPassResult.width;
                    } else {
                        currentLine.push({
                            obj: firstPassResult.text,
                            width: firstPassResult.width,
                            height: firstPassResult.height,
                        });
                        currentLineWidth += firstPassResult.width;
                    }
                } else {
                    addTextWithInlineImagePlaceholders(displayValue, textStyle);
                }
            } else if (part && 'TextImage' in part && part.TextImage != null) {
                addImageSegment(part.TextImage.key, part.TextImage.opts ?? {}, part.TextImage.text);
            }
        }

        // Flush remaining line
        if (currentLine.length > 0) {
            lines.push(currentLine);
        }

        if (lines.length === 0) {
            return effectiveStartY + paddingTop + paddingBottom + marginBottom;
        }

        // Calculate line heights and total content height (include lineSpacing between lines)
        const lineHeights = lines.map((line) => Math.max(...line.map((s) => s.height)));
        const lineSpacing = this.resolveLineSpacing(opts.lineSpacing);
        const totalContentHeight =
            lineHeights.reduce((sum, h) => sum + h, 0) + (lines.length > 1 ? (lines.length - 1) * lineSpacing : 0);

        // Calculate total content width (widest line)
        const lineWidths = lines.map((line) => line.reduce((sum, seg) => sum + seg.width, 0));
        const totalContentWidth = Math.max(...lineWidths, 0);

        // Position content vertically using anchor Y
        const contentAreaHeight = paddingTop + totalContentHeight + paddingBottom;
        const contentAreaTop = effectiveStartY + paddingTop + offsetY;
        const baseY = contentAreaTop + (contentAreaHeight - totalContentHeight) * anchorY;
        const totalHeight = marginTop + paddingTop + offsetY + totalContentHeight + paddingBottom + marginBottom;

        // Position content horizontally using align and anchor X
        // The anchor point should be positioned at: offsetX + paddingLeft + availableWidth * align
        // So the left edge (baseX) should be: anchorXPosition - (totalContentWidth * anchorX)
        const anchorXPosition = offsetX + paddingLeft + availableWidth * align + offsetXFromOpts;
        const baseX = anchorXPosition - (totalContentWidth * anchorX);
        let currentY = baseY;

        // Render each line
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            const lineHeight = lineHeights[lineIndex];

            const lineCenterY = currentY + lineHeight / 2;

            // All lines start at baseX (same X position for consistent wrapping)
            let currentX = baseX;
            for (const seg of line) {
                if (seg.obj instanceof Phaser.GameObjects.Image && seg.anchorX != null && seg.anchorY != null) {
                    // Image: align vertically within the line box, horizontally based on anchorX
                    // Account for left padding when positioning
                    const imagePaddingLeft = seg.imagePaddingLeft ?? 0;
                    const imageWidth = seg.imageWidth ?? seg.width;
                    const imageHeight = seg.imageHeight ?? seg.height;
                    const imgX = currentX + imagePaddingLeft + imageWidth * seg.anchorX;
                    // Keep image anchored to the line center; padding affects line metrics, not center offset.
                    const imgY = lineCenterY - imageHeight * (0.5 - seg.anchorY);
                    seg.obj.setPosition(imgX, imgY);
                    
                    // Add image first so text overlay can be added on top
                    this.mainContentContainer.add(seg.obj);
                    
                    // Position text overlay on the image if it exists
                    // Add it after the image so it renders on top
                    if (seg.textOverlay != null) {
                        const textAlign = seg.textAlign ?? 'center';
                        const imageWidth = seg.imageWidth ?? seg.width;
                        
                        // Calculate text X position based on alignment
                        // imgX is the anchor point position (already accounts for padding)
                        // Left edge of image = imgX - imageWidth * anchorX
                        // Right edge of image = imgX + imageWidth * (1 - anchorX)
                        let textX: number;
                        if (textAlign === 'left') {
                            // Left edge of image
                            textX = imgX - imageWidth * seg.anchorX;
                        } else if (textAlign === 'right') {
                            // Right edge of image
                            textX = imgX + imageWidth * (1 - seg.anchorX);
                        } else {
                            // Center of image (at anchor point)
                            textX = imgX;
                        }
                        
                        seg.textOverlay.setPosition(textX, imgY);
                        this.mainContentContainer.add(seg.textOverlay);
                    }
                    
                    // Advance by total width including padding
                    currentX += seg.width;
                } else {
                    // Text: vertically centered so mixed text/image lines share one center line.
                    seg.obj.setOrigin(0, 0.5);
                    seg.obj.setPosition(currentX, lineCenterY);
                    currentX += seg.width;
                    this.mainContentContainer.add(seg.obj);
                }
            }

            currentY += lineHeight + lineSpacing;
        }

        return startY + totalHeight;
    }

    /**
     * Creates a LineBreak content item with X offset (for border content); returns the Y position below it.
     * Uses graphics with fillRect, matching HelpScreen_OLD.ts implementation.
     */
    private createContentLineBreakWithOffset(
        lineBreak: { opts?: LineBreakOpts },
        containerWidth: number,
        startY: number,
        offsetX: number
    ): number {
        const opts = lineBreak.opts ?? {};
        const marginTop = this.getMarginTop(opts.margin);
        const marginBottom = this.getMarginBottom(opts.margin);
        const paddingTop = this.getPaddingTop(opts.padding);
        const paddingBottom = this.getPaddingBottom(opts.padding);
        const effectiveStartY = startY + marginTop;
        const thickness = opts.thickness ?? 1;

        const lineY = effectiveStartY + paddingTop;
        const dividerGraphics = this.scene.add.graphics();
        dividerGraphics.fillStyle(HelpScreen.LINE_DIVIDER_COLOR, 1);
        dividerGraphics.fillRect(offsetX, lineY, containerWidth, thickness);
        this.mainContentContainer.add(dividerGraphics);

        return lineY + thickness + paddingBottom + marginBottom;
    }

    /**
     * Creates a Grid content item; returns the Y position below it.
     */
    private createContentGrid(
        grid: { opts?: GridOpts; cells: GridCell[] },
        containerWidth: number,
        startY: number
    ): number {
        return this.createContentGridWithOffset(grid, containerWidth, startY, 0);
    }

    /**
     * Creates a Grid content item with X offset (for border content); returns the Y position below it.
     * @param borderRightEdge Optional X position of the border's right edge (for aligning rightmost column)
     * @param borderCenterY Optional Y of the border center; when set, grid rows are positioned so the grid's vertical center is at this Y
     */
    private createContentGridWithOffset(
        grid: { opts?: GridOpts; cells: GridCell[] },
        containerWidth: number,
        startY: number,
        offsetX: number,
        borderRightEdge?: number,
        borderCenterY?: number
    ): number {
        const opts = grid.opts;
        const marginTop = opts != null ? this.getMarginTop(opts.margin) : 0;
        const marginBottom = opts != null ? this.getMarginBottom(opts.margin) : 0;
        if (opts == null || opts.columns == null || opts.rows == null) {
            console.warn('[HelpScreen] Grid requires columns and rows in opts. Skipping grid.');
            return startY + marginTop + marginBottom;
        }

        const paddingTop = this.getPaddingTop(opts.padding);
        const paddingBottom = this.getPaddingBottom(opts.padding);
        const paddingLeft = this.getPaddingLeft(opts.padding);
        const paddingRight = this.getPaddingRight(opts.padding);
        const spacing = opts.spacing ?? 'fit';
        const alignment = opts.alignment ?? 'left';
        const gap = opts.gap ?? 0;
        const baseGapX = typeof gap === 'number' ? gap : gap.x ?? 0;
        const baseGapY = typeof gap === 'number' ? gap : gap.y ?? 0;
        // Grid spacing: horizontalSpacing/verticalSpacing override gap when set (e.g. for fitToWidth/fitToHeight)
        const gapX = opts.horizontalSpacing ?? baseGapX;
        const gapY = opts.verticalSpacing ?? baseGapY;

        const columns = opts.columns;
        const rows = opts.rows;
        const totalCells = columns * rows;

        if (grid.cells.length !== totalCells) {
            console.warn(`[HelpScreen] Grid expects ${totalCells} cells (${columns}x${rows}) but got ${grid.cells.length}. Skipping grid.`);
            return startY + marginTop + marginBottom;
        }

        // Calculate cell dimensions for 'fit' spacing; reserve horizontal padding from container width
        let contentWidth = containerWidth - paddingLeft - paddingRight;
        // When borderRightEdge is set (e.g. grid inside Border/Row), cap content width so the rightmost
        // column aligns to the border without overlapping the column to its left
        const gridLeftX = offsetX + paddingLeft;
        if (borderRightEdge != null && alignment !== 'center') {
            const maxContentToRightEdge = borderRightEdge - paddingRight - gridLeftX;
            if (maxContentToRightEdge < contentWidth && maxContentToRightEdge > 0) {
                contentWidth = maxContentToRightEdge;
            }
        }
        const availableWidth = contentWidth - gapX * (columns - 1);
        const columnWidths = this.resolveGridColumnWidths(columns, availableWidth, opts.columnWidthPercents);
        const totalColumnsWidth = columnWidths.reduce((sum, w) => sum + w, 0);
        const columnStartOffsets: number[] = [];
        let runningColumnOffset = 0;
        for (let i = 0; i < columns; i++) {
            columnStartOffsets.push(runningColumnOffset);
            runningColumnOffset += columnWidths[i];
            if (i < columns - 1) runningColumnOffset += gapX;
        }

        // Position grid with left padding; center/right alignment is relative to the padded content area
        const totalGridWidth = totalColumnsWidth + (columns - 1) * gapX;
        let gridOffsetX: number;
        if (alignment === 'center') {
            gridOffsetX = offsetX + paddingLeft + (contentWidth - totalGridWidth) / 2;
        } else if (alignment === 'right') {
            gridOffsetX = offsetX + paddingLeft + (contentWidth - totalGridWidth);
        } else {
            gridOffsetX = offsetX + paddingLeft;
        }

        // Calculate grid height first (for vertical centering)
        let totalGridHeight = paddingTop + paddingBottom;
        let tempY = 0;
        for (let row = 0; row < rows; row++) {
            let maxRowHeight = 0;
            for (let col = 0; col < columns; col++) {
                const cellIndex = row * columns + col;
                const cell = grid.cells[cellIndex];
                if (cell == null) continue;
                const columnWidth = columnWidths[col] ?? 0;

                let cellHeight = 0;
                if ('Text' in cell && cell.Text != null) {
                    const textOpts = cell.Text.opts ?? {};
                    const cellPaddingTop = this.getPaddingTop(textOpts.padding);
                    const cellPaddingBottom = this.getPaddingBottom(textOpts.padding);
                    const cellPaddingLeft = this.getPaddingLeft(textOpts.padding);
                    const cellPaddingRight = this.getPaddingRight(textOpts.padding);
                    const baseStyle = this.mergeTextStyle(HelpScreen.defaultBodyTextStyle, textOpts.style as Record<string, unknown>);
                    const displayCellText = this.resolveHelpText(cell.Text.key, cell.Text.value);
                    let tempText: Phaser.GameObjects.Text;
                    if (textOpts.fitToBounds === true) {
                        const boundsWidth = Math.max(1, columnWidth - cellPaddingLeft - cellPaddingRight);
                        tempText = this.createTextFittingBounds(
                            displayCellText, boundsWidth, 9999, baseStyle, textOpts
                        );
                        cellHeight = tempText.displayHeight + cellPaddingTop + cellPaddingBottom;
                    } else {
                        const styleWithSpacing = this.applyLineSpacing(baseStyle, textOpts.lineSpacing);
                        const style = this.getTextStyleWithWordWrap(styleWithSpacing, columnWidth);
                        tempText = this.scene.add.text(0, 0, displayCellText, style);
                        cellHeight = tempText.height + cellPaddingTop + cellPaddingBottom;
                    }
                    tempText.destroy();
                } else if ('Image' in cell && cell.Image != null) {
                    const imageOpts = cell.Image.opts ?? {};
                    const cellPaddingTop = this.getPaddingTop(imageOpts.padding);
                    const cellPaddingBottom = this.getPaddingBottom(imageOpts.padding);
                    const imageKey = cell.Image.key ?? cell.Image.src;
                    if (imageKey != null && this.scene.textures.exists(imageKey)) {
                        const tempImg = this.scene.add.image(0, 0, imageKey);
                        const imageSize = imageOpts.size ?? 'native';
                        this.applyImageSizing(tempImg, imageSize, columnWidth, imageOpts.maxHeight);
                        const scaleAffectsLayout = imageOpts.scaleAffectsLayout ?? true;
                        // For layout calculations, only apply scale if it affects layout
                        if (scaleAffectsLayout) {
                            this.applyImageOptsScale(tempImg, imageOpts);
                        }
                        cellHeight = tempImg.displayHeight + cellPaddingTop + cellPaddingBottom;
                        tempImg.destroy();
                    }
                }
                if (cellHeight > maxRowHeight) {
                    maxRowHeight = cellHeight;
                }
            }
            totalGridHeight += maxRowHeight;
            if (row < rows - 1) {
                totalGridHeight += gapY;
            }
        }

        // When borderCenterY is provided, position the grid so its vertical center is at borderCenterY
        let effectiveStartY = startY + marginTop;
        if (borderCenterY != null) {
            effectiveStartY = borderCenterY - totalGridHeight / 2;
        }
        const cellStartY = effectiveStartY + paddingTop;

        let currentY = cellStartY;
        let maxRowHeight = 0;

        // Render grid row by row
        for (let row = 0; row < rows; row++) {
            maxRowHeight = 0;
            const rowStartY = currentY;
            const rowCellWireframes: { left: number; width: number }[] = [];
            const rowRenderedCells: Array<{ obj: Phaser.GameObjects.Text | Phaser.GameObjects.Image; height: number }> = [];

            for (let col = 0; col < columns; col++) {
                const cellIndex = row * columns + col;
                const cell = grid.cells[cellIndex];

                if (cell == null) {
                    continue; // Skip empty cells
                }
                const columnWidth = columnWidths[col] ?? 0;

                // Determine alignment and anchor for this cell based on grid alignment mode
                let cellAlign: number;
                let cellAnchorX: number;

                if (alignment === 'left') {
                    cellAlign = 0; // Left aligned
                    cellAnchorX = 0; // Left anchored
                } else if (alignment === 'right') {
                    cellAlign = 1; // Right aligned
                    cellAnchorX = 1; // Right anchored
                } else if (alignment === 'center') {
                    cellAlign = 0.5; // Center aligned
                    cellAnchorX = 0.5; // Center anchored
                } else if (alignment === 'justified') {
                    if (col === 0) {
                        // Leftmost column: left aligned and anchored
                        cellAlign = 0;
                        cellAnchorX = 0;
                    } else if (col === columns - 1) {
                        // Rightmost column: right aligned and anchored
                        cellAlign = 1;
                        cellAnchorX = 1;
                    } else {
                        // Middle columns: center aligned and anchored
                        cellAlign = 0.5;
                        cellAnchorX = 0.5;
                    }
                } else {
                    // Fallback to left
                    cellAlign = 0;
                    cellAnchorX = 0;
                }
                const columnLeftX = gridOffsetX + (columnStartOffsets[col] ?? 0);

                // Calculate cell X position (use gridOffsetX so center-aligned grid is positioned correctly)
                let cellX: number;

                if (col === columns - 1 && borderRightEdge != null && alignment !== 'center') {
                    // Rightmost column: align to border's right edge minus right padding (not used for center alignment)
                    // borderRightEdge is in absolute coordinates (contentOffsetX + contentWidth)
                    // Since cellAnchorX = 1 (right-anchored), position the anchor at the padded right edge
                    cellX = borderRightEdge - paddingRight;
                } else {
                    // Normal positioning: relative to gridOffsetX (centered when alignment === 'center')
                    cellX = columnLeftX + columnWidth * cellAlign;
                }

                // Render the cell (text or image)
                let cellHeight = 0;
                if ('Text' in cell && cell.Text != null) {
                    // Create text cell
                    const textOpts = cell.Text.opts ?? {};
                    const cellPaddingTop = this.getPaddingTop(textOpts.padding);
                    const cellPaddingBottom = this.getPaddingBottom(textOpts.padding);
                    const cellPaddingLeft = this.getPaddingLeft(textOpts.padding);
                    const cellPaddingRight = this.getPaddingRight(textOpts.padding);
                    const baseStyle = this.mergeTextStyle(HelpScreen.defaultBodyTextStyle, textOpts.style as Record<string, unknown>);
                    const displayCellText = this.resolveHelpText(cell.Text.key, cell.Text.value);
                    let textObj: Phaser.GameObjects.Text;
                    if (textOpts.fitToBounds === true) {
                        const boundsWidth = Math.max(1, columnWidth - cellPaddingLeft - cellPaddingRight);
                        textObj = this.createTextFittingBounds(
                            displayCellText, boundsWidth, 9999, baseStyle, textOpts
                        );
                    } else {
                        const styleWithSpacing = this.applyLineSpacing(baseStyle, textOpts.lineSpacing);
                        const style = this.getTextStyleWithWordWrap(styleWithSpacing, columnWidth);
                        const isRTL = textOpts.rtl === true;
                        if (isRTL) (style as TextStyle).rtl = true;
                        textObj = this.scene.add.text(0, 0, displayCellText, style);
                        if (isRTL) textObj.setRTL(true);
                    }

                    textObj.setOrigin(cellAnchorX, 0);
                    textObj.setPosition(cellX, rowStartY + cellPaddingTop);
                    this.mainContentContainer.add(textObj);

                    cellHeight = textObj.displayHeight + cellPaddingTop + cellPaddingBottom;
                    rowRenderedCells.push({ obj: textObj, height: cellHeight });
                } else if ('Image' in cell && cell.Image != null) {
                    // Create image cell
                    const imageOpts = cell.Image.opts ?? {};
                    const cellPaddingTop = this.getPaddingTop(imageOpts.padding);
                    const cellPaddingBottom = this.getPaddingBottom(imageOpts.padding);
                    const cellPaddingLeft = this.getPaddingLeft(imageOpts.padding);
                    const cellPaddingRight = this.getPaddingRight(imageOpts.padding);

                    const imageKey = cell.Image.key ?? cell.Image.src;
                    if (imageKey != null) {
                        const img = this.scene.add.image(0, 0, imageKey);
                        const imageSize = imageOpts.size ?? 'native';
                        // For fitToWidth, use available width after accounting for left/right padding
                        const availableWidth = columnWidth - cellPaddingLeft - cellPaddingRight;
                        const sizingWidth = imageSize === 'fitToWidth' ? availableWidth : columnWidth;
                        this.applyImageSizing(img, imageSize, sizingWidth, imageOpts.maxHeight);
                        const scaleAffectsLayout = imageOpts.scaleAffectsLayout ?? true;

                        // Calculate layout dimensions BEFORE applying scale if scale doesn't affect layout
                        let layoutHeight: number;
                        if (!scaleAffectsLayout) {
                            layoutHeight = img.displayHeight;
                            // Apply visual scale AFTER layout calculations (doesn't affect layout)
                            this.applyImageOptsScale(img, imageOpts);
                        } else {
                            // Scale affects layout (default behavior)
                            this.applyImageOptsScale(img, imageOpts);
                            layoutHeight = img.displayHeight;
                        }

                        img.setOrigin(cellAnchorX, 0);
                        // Position image accounting for padding based on anchor
                        // cellX is the anchor point, so adjust based on anchor position
                        let imageX: number;
                        if (cellAnchorX === 0) {
                            // Left anchor: add left padding
                            imageX = cellX + cellPaddingLeft;
                        } else if (cellAnchorX === 1) {
                            // Right anchor: subtract right padding
                            imageX = cellX - cellPaddingRight;
                        } else {
                            // Center anchor (0.5): no adjustment needed (padding is symmetric)
                            imageX = cellX;
                        }
                        img.setPosition(imageX, rowStartY + cellPaddingTop);
                        this.mainContentContainer.add(img);

                        cellHeight = layoutHeight + cellPaddingTop + cellPaddingBottom;
                        rowRenderedCells.push({ obj: img, height: cellHeight });
                    }
                }

                // Store wireframe geometry; draw after row height is known
                if (cellHeight > 0) {
                    const cellLeft = cellX - cellAnchorX * columnWidth;
                    rowCellWireframes.push({ left: cellLeft, width: columnWidth });
                }

                // Track the tallest cell in this row
                if (cellHeight > maxRowHeight) {
                    maxRowHeight = cellHeight;
                }
            }

            // Vertically center each rendered cell item within the row's final slot height.
            for (const rendered of rowRenderedCells) {
                const yOffset = (maxRowHeight - rendered.height) / 2;
                if (yOffset !== 0) {
                    rendered.obj.setY(rendered.obj.y + yOffset);
                }
            }

            // Draw each cell using full row slot height (not just rendered text/image height)
            for (const wireframe of rowCellWireframes) {
                this.drawGridCellWireframe(wireframe.left, rowStartY, wireframe.width, maxRowHeight);
            }

            // Move to next row
            currentY = rowStartY + maxRowHeight + gapY;
        }

        return effectiveStartY + totalGridHeight + marginBottom;
    }

    /**
     * Creates a Row content item; returns the Y position below it.
     */
    private createContentRow(
        row: { opts?: RowOpts; items: ContentItem[] },
        containerWidth: number,
        startY: number
    ): number {
        return this.createContentRowWithOffset(row, containerWidth, startY, 0);
    }

    /**
     * Resolves per-column widths for a grid, supporting optional column width percentages.
     * When percentages are missing/invalid, columns are distributed equally.
     */
    private resolveGridColumnWidths(
        columns: number,
        availableWidth: number,
        columnWidthPercents?: number[]
    ): number[] {
        const safeColumns = Math.max(1, columns);
        const safeAvailableWidth = Math.max(0, availableWidth);
        const equalWidth = safeAvailableWidth / safeColumns;

        if (columnWidthPercents == null || columnWidthPercents.length === 0) {
            return new Array(safeColumns).fill(equalWidth);
        }

        // Use provided percentages (up to column count), and if fewer are provided,
        // distribute the remaining percentage equally to missing columns.
        const providedCount = Math.min(safeColumns, columnWidthPercents.length);
        const provided = columnWidthPercents
            .slice(0, providedCount)
            .map((v) => Math.max(0, Number(v) || 0));
        const providedTotal = provided.reduce((sum, v) => sum + v, 0);

        const missingCount = safeColumns - providedCount;
        const remainingPercent = Math.max(0, 100 - providedTotal);
        const fillForMissing = missingCount > 0 ? remainingPercent / missingCount : 0;

        const percents: number[] = [...provided];
        for (let i = 0; i < missingCount; i++) {
            percents.push(fillForMissing);
        }

        // Normalize to ensure final widths always fit available width.
        const total = percents.reduce((sum, v) => sum + v, 0);
        if (total <= 0) {
            return new Array(safeColumns).fill(equalWidth);
        }

        return percents.map((v) => (v / total) * safeAvailableWidth);
    }

    /**
     * Creates a Row content item with X offset (for border content); returns the Y position below it.
     * A Row allows multiple content items to share the same yPosition but spread horizontally.
     * If inside a border (offsetX > 0), items are centered vertically within the border's content area.
     * @param borderStartY Optional Y position where the border starts (for centering calculations)
     * @param borderPaddingTop Optional top padding of the border (for centering calculations)
     * @param borderPaddingBottom Optional bottom padding of the border (for centering calculations)
     * @param borderRightEdge Optional X position of the border's right edge (for grid alignment)
     */
    private createContentRowWithOffset(
        row: { opts?: RowOpts; items: ContentItem[] },
        containerWidth: number,
        startY: number,
        offsetX: number,
        borderStartY?: number,
        borderPaddingTop?: number,
        borderPaddingBottom?: number,
        borderRightEdge?: number
    ): number {
        const opts = row.opts ?? {};
        const marginTop = this.getMarginTop(opts.margin);
        const marginBottom = this.getMarginBottom(opts.margin);
        const paddingTop = this.getPaddingTop(opts.padding);
        const paddingBottom = this.getPaddingBottom(opts.padding);
        const effectiveStartY = startY + marginTop;
        const spacing = opts.spacing ?? 'fit';
        const gap = opts.gap ?? 0;

        if (row.items.length === 0) {
            return effectiveStartY + paddingTop + paddingBottom + marginBottom;
        }

        // Check if we're inside a border (border adds left padding, so offsetX > 0)
        const isInsideBorder = offsetX > 0;

        // First pass: calculate item heights for vertical centering
        const itemHeights: number[] = [];
        let maxItemHeight = 0;
        for (const item of row.items) {
            let itemHeight = 0;
            if ('Image' in item && item.Image != null) {
                const imageKey = item.Image.key ?? item.Image.src;
                if (imageKey != null && this.scene.textures.exists(imageKey)) {
                    const imageOpts = item.Image.opts ?? {};
                    const tempImg = this.scene.add.image(0, 0, imageKey);
                    const imageSize = imageOpts.size ?? 'native';
                    this.applyImageSizing(tempImg, imageSize, containerWidth, imageOpts.maxHeight);
                    const scaleAffectsLayout = imageOpts.scaleAffectsLayout ?? true;
                    // For layout calculations, only apply scale if it affects layout
                    if (scaleAffectsLayout) {
                        this.applyImageOptsScale(tempImg, imageOpts);
                    }
                    const cellPaddingTop = this.getPaddingTop(imageOpts.padding);
                    const cellPaddingBottom = this.getPaddingBottom(imageOpts.padding);
                    itemHeight = tempImg.displayHeight + cellPaddingTop + cellPaddingBottom;
                    tempImg.destroy();
                }
            } else if ('Grid' in item && item.Grid != null) {
                // Calculate grid height
                const gridOpts = item.Grid.opts;
                if (gridOpts?.columns != null && gridOpts?.rows != null) {
                    const gapX = typeof gridOpts.gap === 'number' ? gridOpts.gap : gridOpts.gap?.x ?? 0;
                    const gapY = typeof gridOpts.gap === 'number' ? gridOpts.gap : gridOpts.gap?.y ?? 0;
                    const availableGridWidth = containerWidth - gapX * (gridOpts.columns - 1);
                    const columnWidths = this.resolveGridColumnWidths(
                        gridOpts.columns,
                        availableGridWidth,
                        gridOpts.columnWidthPercents
                    );
                    const gridPaddingTop = this.getPaddingTop(gridOpts.padding);
                    const gridPaddingBottom = this.getPaddingBottom(gridOpts.padding);
                    let gridHeight = gridPaddingTop + gridPaddingBottom;
                    for (let row = 0; row < gridOpts.rows; row++) {
                        let maxRowHeight = 0;
                        for (let col = 0; col < gridOpts.columns; col++) {
                            const cellIndex = row * gridOpts.columns + col;
                            const cell = item.Grid.cells[cellIndex];
                            if (cell == null) continue;
                            const columnWidth = columnWidths[col] ?? 0;
                            let cellHeight = 0;
                            if ('Text' in cell && cell.Text != null) {
                                const textOpts = cell.Text.opts ?? {};
                                const cellPaddingTop = this.getPaddingTop(textOpts.padding);
                                const cellPaddingBottom = this.getPaddingBottom(textOpts.padding);
                                const cellPaddingLeft = this.getPaddingLeft(textOpts.padding);
                                const cellPaddingRight = this.getPaddingRight(textOpts.padding);
                                const baseStyle = this.mergeTextStyle(HelpScreen.defaultBodyTextStyle, textOpts.style as Record<string, unknown>);
                                const displayCellText = this.resolveHelpText(cell.Text.key, cell.Text.value);
                                let tempText: Phaser.GameObjects.Text;
                                if (textOpts.fitToBounds === true) {
                                    const boundsWidth = Math.max(1, columnWidth - cellPaddingLeft - cellPaddingRight);
                                    tempText = this.createTextFittingBounds(
                                        displayCellText, boundsWidth, 9999, baseStyle, textOpts
                                    );
                                    cellHeight = tempText.displayHeight + cellPaddingTop + cellPaddingBottom;
                                } else {
                                    const styleWithSpacing = this.applyLineSpacing(baseStyle, textOpts.lineSpacing);
                                    const style = this.getTextStyleWithWordWrap(styleWithSpacing, columnWidth);
                                    tempText = this.scene.add.text(0, 0, displayCellText, style);
                                    cellHeight = tempText.height + cellPaddingTop + cellPaddingBottom;
                                }
                                tempText.destroy();
                            } else if ('Image' in cell && cell.Image != null) {
                                const cellImageOpts = cell.Image.opts ?? {};
                                const cellPaddingTop = this.getPaddingTop(cellImageOpts.padding);
                                const cellPaddingBottom = this.getPaddingBottom(cellImageOpts.padding);
                                const cellImageKey = cell.Image.key ?? cell.Image.src;
                                if (cellImageKey != null && this.scene.textures.exists(cellImageKey)) {
                                    const tempCellImg = this.scene.add.image(0, 0, cellImageKey);
                                    const cellImageSize = cellImageOpts.size ?? 'native';
                                    this.applyImageSizing(tempCellImg, cellImageSize, columnWidth, cellImageOpts.maxHeight);
                                    const scaleAffectsLayout = cellImageOpts.scaleAffectsLayout ?? true;
                                    // For layout calculations, only apply scale if it affects layout
                                    if (scaleAffectsLayout) {
                                        this.applyImageOptsScale(tempCellImg, cellImageOpts);
                                    }
                                    cellHeight = tempCellImg.displayHeight + cellPaddingTop + cellPaddingBottom;
                                    tempCellImg.destroy();
                                }
                            }
                            if (cellHeight > maxRowHeight) {
                                maxRowHeight = cellHeight;
                            }
                        }
                        gridHeight += maxRowHeight;
                        if (row < gridOpts.rows - 1) {
                            gridHeight += gapY;
                        }
                    }
                    itemHeight = gridHeight;
                }
            } else if ('Text' in item && item.Text != null) {
                const textOpts = item.Text.opts ?? {};
                const cellPaddingTop = this.getPaddingTop(textOpts.padding);
                const cellPaddingBottom = this.getPaddingBottom(textOpts.padding);
                const baseStyle = this.mergeTextStyle(HelpScreen.defaultBodyTextStyle, textOpts.style as Record<string, unknown>);
                const styleWithSpacing = this.applyLineSpacing(baseStyle, textOpts.lineSpacing);
                const style = this.getTextStyleWithWordWrap(styleWithSpacing, containerWidth);
                const displayItemText = this.resolveHelpText(item.Text.key, item.Text.value);
                const tempText = this.scene.add.text(0, 0, displayItemText, style);
                itemHeight = tempText.height + cellPaddingTop + cellPaddingBottom;
                tempText.destroy();
            }
            itemHeights.push(itemHeight);
            if (itemHeight > maxItemHeight) {
                maxItemHeight = itemHeight;
            }
        }

        // Row total height: single row uses max item height
        const rowTotalHeight = maxItemHeight + paddingTop + paddingBottom;

        // Calculate border center Y if inside a border
        let borderCenterY: number | undefined;
        if (isInsideBorder && borderStartY != null && borderPaddingTop != null && borderPaddingBottom != null) {
            const estimatedBorderHeight = rowTotalHeight + borderPaddingTop + borderPaddingBottom;
            borderCenterY = borderStartY + estimatedBorderHeight / 2;
        }

        // Starting Y: if inside a border, center row content vertically; otherwise below padding
        let rowStartY: number;
        if (isInsideBorder && borderCenterY != null) {
            rowStartY = borderCenterY - paddingTop - maxItemHeight / 2;
        } else {
            rowStartY = effectiveStartY + paddingTop;
        }

        if (spacing === 'fit') {
            // Calculate widths for each item based on their natural sizes
            const naturalItemWidths: number[] = [];
            let totalNaturalWidth = 0;

            // Second pass: calculate natural widths
            for (const item of row.items) {
                let itemWidth = 0;
                if ('Image' in item && item.Image != null) {
                    const imageKey = item.Image.key ?? item.Image.src;
                    if (imageKey != null && this.scene.textures.exists(imageKey)) {
                        const imageOpts = item.Image.opts ?? {};
                        const imageSize = imageOpts.size ?? 'native';

                        // For accurate width calculation, create a temporary image, apply sizing, and measure its displayWidth
                        const tempImg = this.scene.add.image(0, 0, imageKey);
                        this.applyImageSizing(tempImg, imageSize, containerWidth, imageOpts.maxHeight);
                        const scaleAffectsLayout = imageOpts.scaleAffectsLayout ?? true;
                        // For layout calculations, only apply scale if it affects layout
                        if (scaleAffectsLayout) {
                            this.applyImageOptsScale(tempImg, imageOpts);
                        }
                        itemWidth = tempImg.displayWidth;
                        tempImg.destroy();
                    }
                } else if ('Grid' in item && item.Grid != null) {
                    // Estimate grid width based on columns
                    const gridOpts = item.Grid.opts;
                    if (gridOpts?.columns != null) {
                        const gapX = typeof gridOpts.gap === 'number' ? gridOpts.gap : gridOpts.gap?.x ?? 0;
                        itemWidth = (containerWidth - gapX * (gridOpts.columns - 1)) / gridOpts.columns * gridOpts.columns + gapX * (gridOpts.columns - 1);
                    }
                } else if ('Text' in item && item.Text != null) {
                    // Estimate text width (will be refined when actually rendered)
                    const textOpts = item.Text.opts ?? {};
                    const baseStyle = this.mergeTextStyle(HelpScreen.defaultBodyTextStyle, textOpts.style as Record<string, unknown>);
                    const styleWithSpacing = this.applyLineSpacing(baseStyle, textOpts.lineSpacing);
                    const style = this.getTextStyleWithWordWrap(styleWithSpacing, containerWidth);
                    const displayItemText = this.resolveHelpText(item.Text.key, item.Text.value);
                const tempText = this.scene.add.text(0, 0, displayItemText, style);
                    itemWidth = tempText.width;
                    tempText.destroy();
                }
                naturalItemWidths.push(itemWidth);
                totalNaturalWidth += itemWidth;
            }

            // Calculate available width after gaps
            const totalGapWidth = gap * (row.items.length - 1);
            const availableWidth = containerWidth - totalGapWidth;

            // Distribute width proportionally or equally
            let currentX = offsetX;
            for (let i = 0; i < row.items.length; i++) {
                const item = row.items[i];
                const naturalWidth = naturalItemWidths[i];
                const itemWidth = totalNaturalWidth > 0
                    ? (naturalWidth / totalNaturalWidth) * availableWidth
                    : availableWidth / row.items.length;

                // Calculate vertical offset to center this item within maxItemHeight
                const itemHeight = itemHeights[i];
                const itemVerticalOffset = (maxItemHeight - itemHeight) / 2;
                let itemY = rowStartY + itemVerticalOffset;

                // If inside a border and this is an Image with anchor y=0.5, position it at border center Y
                if (isInsideBorder && borderCenterY != null && 'Image' in item && item.Image != null) {
                    const imageOpts = item.Image.opts ?? {};
                    const anchorObj = imageOpts.anchor != null && typeof imageOpts.anchor === 'object' ? imageOpts.anchor : undefined;
                    const anchorY = anchorObj?.y ?? 0;
                    if (anchorY === 0.5) {
                        // Position image so its center (anchor 0.5) is at border center Y
                        itemY = borderCenterY;
                    }
                }

                // Render item at current position (vertically centered)
                const renderResult = this.renderRowItem(item, currentX, itemY, itemWidth, containerWidth, borderCenterY, borderRightEdge);
                const nextX = renderResult.rightEdge ?? currentX + (renderResult.width ?? itemWidth);
                currentX = nextX + gap;
            }
        } else if (spacing === 'spread') {
            // Distribute items evenly across width
            const totalGapWidth = gap * (row.items.length - 1);
            const availableWidth = containerWidth - totalGapWidth;
            const itemWidth = availableWidth / row.items.length;

            let currentX = offsetX;
            for (let i = 0; i < row.items.length; i++) {
                const item = row.items[i];
                // Calculate vertical offset to center this item within maxItemHeight
                const itemHeight = itemHeights[i];
                const itemVerticalOffset = (maxItemHeight - itemHeight) / 2;
                let itemY = rowStartY + itemVerticalOffset;

                // If inside a border and this is an Image with anchor y=0.5, position it at border center Y
                if (isInsideBorder && borderCenterY != null && 'Image' in item && item.Image != null) {
                    const imageOpts = item.Image.opts ?? {};
                    const anchorObj = imageOpts.anchor != null && typeof imageOpts.anchor === 'object' ? imageOpts.anchor : undefined;
                    const anchorY = anchorObj?.y ?? 0;
                    if (anchorY === 0.5) {
                        // Position image so its center (anchor 0.5) is at border center Y
                        itemY = borderCenterY;
                    }
                }

                // Render item at current position (vertically centered); fixed slots so advance by itemWidth + gap
                this.renderRowItem(item, currentX, itemY, itemWidth, containerWidth, borderCenterY, borderRightEdge);
                currentX += itemWidth + gap;
            }
        }

        return rowStartY + maxItemHeight + paddingBottom + marginBottom;
    }

    /**
     * Renders a single item within a row at the specified position.
     * Returns height, optional width, and rightEdge (x of right edge) so the next item can be placed without overlap.
     * @param borderCenterY Optional border center Y for special positioning (e.g., images with anchor 0.5)
     * @param borderRightEdge Optional border right edge X for grid alignment
     */
    private renderRowItem(
        item: ContentItem,
        x: number,
        y: number,
        itemWidth: number,
        containerWidth: number,
        borderCenterY?: number,
        borderRightEdge?: number
    ): { height: number; width?: number; rightEdge?: number } {
        if ('Image' in item && item.Image != null) {
            const imageOpts = item.Image.opts ?? {};
            const cellPaddingTop = this.getPaddingTop(imageOpts.padding);
            const cellPaddingBottom = this.getPaddingBottom(imageOpts.padding);
            const cellPaddingLeft = this.getPaddingLeft(imageOpts.padding);
            const cellPaddingRight = this.getPaddingRight(imageOpts.padding);

            const imageKey = item.Image.key ?? item.Image.src;
            if (imageKey != null) {
                const img = this.scene.add.image(0, 0, imageKey);
                const imageSize = imageOpts.size ?? 'native';
                // For fitToWidth, use available width after accounting for left/right padding
                const availableWidth = itemWidth - cellPaddingLeft - cellPaddingRight;
                const sizingWidth = imageSize === 'fitToWidth' ? availableWidth : itemWidth;
                this.applyImageSizing(img, imageSize, sizingWidth, imageOpts.maxHeight);
                const scaleAffectsLayout = imageOpts.scaleAffectsLayout ?? true;

                // Calculate layout dimensions BEFORE applying scale if scale doesn't affect layout
                let layoutHeight: number;
                let layoutWidth: number;
                if (!scaleAffectsLayout) {
                    layoutHeight = img.displayHeight;
                    layoutWidth = img.displayWidth;
                    // Apply visual scale AFTER layout calculations (doesn't affect layout)
                    this.applyImageOptsScale(img, imageOpts);
                } else {
                    // Scale affects layout (default behavior)
                    this.applyImageOptsScale(img, imageOpts);
                    layoutHeight = img.displayHeight;
                    layoutWidth = img.displayWidth;
                }

                const anchorObj = imageOpts.anchor != null && typeof imageOpts.anchor === 'object' ? imageOpts.anchor : undefined;
                const anchorX = anchorObj?.x ?? 0;
                const anchorY = anchorObj?.y ?? 0.5;
                img.setOrigin(anchorX, anchorY);

                const align = typeof imageOpts.align === 'number' ? imageOpts.align : 0;
                const offsetXFromOpts = imageOpts.offset?.x ?? 0;

                // If borderCenterY is provided and anchorY is 0.5, position image center at border center Y
                // Otherwise, use the provided y position (which may already account for centering)
                let imageY: number;
                if (borderCenterY != null && anchorY === 0.5) {
                    // Position image center at border center Y (ignore paddingTop for anchor positioning)
                    imageY = borderCenterY;
                } else {
                    // Use provided y position with padding
                    imageY = y + cellPaddingTop;
                }

                // Position image accounting for left padding and alignment
                const imageX = x + cellPaddingLeft + availableWidth * align + offsetXFromOpts;
                img.setPosition(imageX, imageY);
                this.mainContentContainer.add(img);

                // rightEdge so next item starts after this image (avoids overlap when image is centered in slot)
                const rightEdge = imageX + (1 - anchorX) * layoutWidth;
                return {
                    height: layoutHeight + cellPaddingTop + cellPaddingBottom,
                    width: layoutWidth,
                    rightEdge,
                };
            }
            return { height: 0 };
        } else if ('Grid' in item && item.Grid != null) {
            // Render grid within the item width
            // Calculate border right edge if we're inside a border (x > 0 typically indicates border offset)
            // For Row items, we need to calculate based on the containerWidth and offsetX
            // Since we're in a Row, x is the item's left position, and itemWidth is the allocated width
            // The border right edge would be: we need to pass this from the Row rendering
            // borderRightEdge is passed from Row rendering and is in absolute coordinates
            // Pass it to grid so rightmost column can align to border edge
            const gridHeight = this.createContentGridWithOffset(item.Grid, itemWidth, y, x, borderRightEdge, borderCenterY) - y;
            return {
                height: gridHeight,
                width: itemWidth,
                rightEdge: x + itemWidth,
            };
        } else if ('Text' in item && item.Text != null) {
            const textOpts = item.Text.opts ?? {};
            const cellPaddingTop = this.getPaddingTop(textOpts.padding);
            const cellPaddingBottom = this.getPaddingBottom(textOpts.padding);

            const baseStyle = this.mergeTextStyle(HelpScreen.defaultBodyTextStyle, textOpts.style as Record<string, unknown>);
            const styleWithSpacing = this.applyLineSpacing(baseStyle, textOpts.lineSpacing);
            const style = this.getTextStyleWithWordWrap(styleWithSpacing, itemWidth);

            const isRTL = textOpts.rtl === true;
            if (isRTL) {
                style.rtl = true;
            }

            const displayItemText = this.resolveHelpText(item.Text.key, item.Text.value);
            const textObj = this.scene.add.text(0, 0, displayItemText, style);

            if (isRTL) {
                textObj.setRTL(true);
            }

            const anchorObj = textOpts.anchor != null && typeof textOpts.anchor === 'object' ? textOpts.anchor : undefined;
            const anchorX = anchorObj?.x ?? 0;
            const anchorY = anchorObj?.y ?? 0.5;
            textObj.setOrigin(anchorX, anchorY);

            const align = typeof textOpts.align === 'number' ? textOpts.align : 0;
            const offsetXFromOpts = textOpts.offset?.x ?? 0;
            const textX = x + itemWidth * align + offsetXFromOpts;
            textObj.setPosition(textX, y + cellPaddingTop);
            this.mainContentContainer.add(textObj);

            const textRightEdge = textX + (1 - anchorX) * textObj.width;
            return {
                height: textObj.height + cellPaddingTop + cellPaddingBottom,
                width: itemWidth,
                rightEdge: textRightEdge,
            };
        }
        return { height: 0 };
    }

    /**
     * Creates a ContentSection with X offset (for nested sections inside borders); returns the Y position below it.
     */
    private createContentSectionWithOffset(
        contentSection: ContentSection,
        startY: number,
        offsetX: number,
        containerWidth: number
    ): number {
        // Pass the offsetX and containerWidth to createContentSection so nested sections are positioned correctly; isRoot=false for wireframe green
        return this.createContentSection(contentSection, startY, offsetX, containerWidth, false);
    }

    private getPaddingTop(padding: number | { top?: number; right?: number; bottom?: number; left?: number } | undefined): number {
        if (padding === undefined) return 0;
        if (typeof padding === 'number') return padding;
        return padding.top ?? 0;
    }

    private getPaddingBottom(padding: number | { top?: number; right?: number; bottom?: number; left?: number } | undefined): number {
        if (padding === undefined) return 0;
        if (typeof padding === 'number') return padding;
        return padding.bottom ?? 0;
    }

    private getPaddingLeft(padding: number | { top?: number; right?: number; bottom?: number; left?: number } | undefined): number {
        if (padding === undefined) return 0;
        if (typeof padding === 'number') return padding;
        return padding.left ?? 0;
    }

    private getPaddingRight(padding: number | { top?: number; right?: number; bottom?: number; left?: number } | undefined): number {
        if (padding === undefined) return 0;
        if (typeof padding === 'number') return padding;
        return padding.right ?? 0;
    }

    private getMarginTop(margin: number | { top?: number; right?: number; bottom?: number; left?: number } | undefined): number {
        if (margin === undefined) return 0;
        if (typeof margin === 'number') return margin;
        return margin.top ?? 0;
    }

    private getMarginBottom(margin: number | { top?: number; right?: number; bottom?: number; left?: number } | undefined): number {
        if (margin === undefined) return 0;
        if (typeof margin === 'number') return margin;
        return margin.bottom ?? 0;
    }

    private getMarginLeft(margin: number | { top?: number; right?: number; bottom?: number; left?: number } | undefined): number {
        if (margin === undefined) return 0;
        if (typeof margin === 'number') return margin;
        return margin.left ?? 0;
    }

    private getMarginRight(margin: number | { top?: number; right?: number; bottom?: number; left?: number } | undefined): number {
        if (margin === undefined) return 0;
        if (typeof margin === 'number') return margin;
        return margin.right ?? 0;
    }

    private setupScrollableRulesContent(scene: GameScene): void {
        this.scrollView = scene.add.container(0, 0);
        this.contentContainer = scene.add.container(0, 0);
        this.sectionWireframesContainer = scene.add.container(0, 0);
        this.mainContentContainer = scene.add.container(0, 0);
        this.elementWireframesContainer = scene.add.container(0, 0);
        this.contentContainer.add(this.sectionWireframesContainer);
        this.contentContainer.add(this.mainContentContainer);
        this.contentContainer.add(this.elementWireframesContainer);
        this.scrollView.add(this.contentContainer);
        this.enableScrolling(scene);
    }

    /** Returns scroll bounds used for clamping content container Y. */
    private getScrollBounds(): { maxY: number; minY: number; contentHeight: number; viewHeight: number } {
        const contentHeight = this.contentHeight || this.yPosition;
        const viewHeight = this.contentArea.height;
        const maxY = 0;
        const minY = Math.min(0, viewHeight - contentHeight);
        return { maxY, minY, contentHeight, viewHeight };
    }

    private enableScrolling(scene: Scene): void {
        let isDragging = false;
        let startY = 0;
        let currentY = 0;
        let lastY = 0;
        let dragVelocity = 0;
        const minVelocity = 0.1;
        const dragThreshold = 8;
        let hasExceededDragThreshold = false;
        let hasMoved = false; // Track if pointer actually moved during drag

        this.scrollView.setInteractive(
            new Phaser.Geom.Rectangle(0, 0, this.contentArea.width, this.contentArea.height),
            Phaser.Geom.Rectangle.Contains
        );

        this.ensureTabInteractionBlocker(scene);

        this.scrollView.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            isDragging = true;
            // pointer.worldY = logical game px (pointer.y is physical canvas px under HiResRender).
            startY = pointer.worldY;
            lastY = pointer.worldY;
            dragVelocity = 0; // Reset drag velocity to prevent stale values
            hasExceededDragThreshold = false;
            hasMoved = false; // Reset movement flag
            this.setTabInteractionBlocked(scene, false);
            if (scene.tweens.isTweening(this.contentContainer)) {
                scene.tweens.killTweensOf(this.contentContainer);
            }
        });

        scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
            if (!isDragging || !this.isMenuVisible()) return;

            const deltaY = pointer.worldY - lastY;
            if (Math.abs(deltaY) > 0) {
                hasMoved = true; // Mark that movement occurred
            }

            if (!hasExceededDragThreshold && Math.abs(pointer.worldY - startY) >= dragThreshold) {
                hasExceededDragThreshold = true;
                this.setTabInteractionBlocked(scene, true);
            }

            lastY = pointer.worldY;
            dragVelocity = deltaY;
            currentY = this.contentContainer.y + deltaY;

            const { maxY, minY } = this.getScrollBounds();
            if (currentY > maxY) {
                currentY = maxY + (currentY - maxY) * 0.5;
            } else if (currentY < minY) {
                currentY = minY + (currentY - minY) * 0.5;
            }

            this.contentContainer.y = currentY;
        });

        scene.input.on('pointerup', () => {
            if (!isDragging) return;
            isDragging = false;
            if (hasExceededDragThreshold) {
                this.setTabInteractionBlocked(scene, false);
            }
            hasExceededDragThreshold = false;

            // Only process scroll momentum/adjustment if there was actual movement
            if (hasMoved) {
                if (Math.abs(dragVelocity) > minVelocity) {
                    const { maxY, minY } = this.getScrollBounds();
                    let targetY = this.contentContainer.y + dragVelocity * 20;
                    targetY = Phaser.Math.Clamp(targetY, minY, maxY);

                    scene.tweens.add({
                        targets: this.contentContainer,
                        y: targetY,
                        duration: 500,
                        ease: 'Cubic.out',
                    });
                } else {
                    const { maxY, minY } = this.getScrollBounds();
                    const targetY = Phaser.Math.Clamp(this.contentContainer.y, minY, maxY);

                    if (targetY !== this.contentContainer.y) {
                        scene.tweens.add({
                            targets: this.contentContainer,
                            y: targetY,
                            duration: 200,
                            ease: 'Cubic.out',
                        });
                    }
                }
            }
            // Reset movement flag for next interaction
            hasMoved = false;
        });

        scene.input.on('wheel', (_pointer: unknown, _gameObjects: unknown, _deltaX: number, deltaY: number) => {
            if (!this.isMenuVisible()) return;

            const { maxY, minY } = this.getScrollBounds();
            currentY = Phaser.Math.Clamp(this.contentContainer.y - deltaY, minY, maxY);

            scene.tweens.add({
                targets: this.contentContainer,
                y: currentY,
                duration: 100,
                ease: 'Cubic.out',
            });
        });
    }

    private ensureTabInteractionBlocker(scene: Scene): void {
        if (this.tabInteractionBlocker) {
            return;
        }

        const blockerWidth = scene.scale.width;
        const blockerHeight = this.tabHeight;
        const blocker = scene.add.zone(0, this.menuTopPadding, blockerWidth, blockerHeight);
        blocker.setOrigin(0, 0);
        blocker.setDepth(3000);
        blocker.setScrollFactor(0);

        this.tabInteractionHitArea = new Phaser.Geom.Rectangle(0, 0, blockerWidth, blockerHeight);
        blocker.setInteractive(this.tabInteractionHitArea, Phaser.Geom.Rectangle.Contains);
        if (blocker.input) {
            blocker.input.enabled = false;
        }

        this.tabInteractionBlocker = blocker;
    }

    private setTabInteractionBlocked(scene: Scene, shouldBlock: boolean): void {
        if (!this.tabInteractionBlocker) {
            this.ensureTabInteractionBlocker(scene);
        }

        if (!this.tabInteractionBlocker || this.isTabInteractionBlocked === shouldBlock) {
            return;
        }

        const blocker = this.tabInteractionBlocker;
        blocker.setPosition(0, this.menuTopPadding);
        blocker.setSize(scene.scale.width, this.tabHeight);

        if (this.tabInteractionHitArea) {
            this.tabInteractionHitArea.width = blocker.width;
            this.tabInteractionHitArea.height = blocker.height;
        }

        if (blocker.input) {
            blocker.input.enabled = shouldBlock;
        }

        this.isTabInteractionBlocked = shouldBlock;
    }
}
