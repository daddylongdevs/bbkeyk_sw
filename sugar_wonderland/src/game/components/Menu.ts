import { Scene, GameObjects } from 'phaser';
import { Geom } from 'phaser';
import { GameData } from '../components/GameData';
import { AudioManager, SoundEffectType } from '../../managers/AudioManager';
import { GameAPI } from '../../backend/GameAPI';
import { HelpScreen } from './MenuTabs/HelpScreen';
import { CurrencyManager } from './CurrencyManager';
import { formatCurrencyNumber } from '../../utils/NumberPrecisionFormatter';
import { localizationManager } from '../../managers/LocalizationManager';
import { MENU_RULES, MENU_HISTORY, COMMON_SETTINGS, MENU_BACKGROUND_MUSIC, MENU_SOUND_FX, MENU_SKIP_INTRO, LOCALIZATION_DEFAULTS } from '../../backend/LocalizationData';

interface ButtonBase {
    isButton: boolean;
}

type ButtonContainer = GameObjects.Container & ButtonBase;
type ButtonImage = GameObjects.Image & ButtonBase;
type ButtonText = GameObjects.Text & ButtonBase;

interface TabConfig {
    text: string;
    width: number;
    x: number;
    icon: string;
}

interface GameScene extends Scene {
    gameData: GameData;
    audioManager: AudioManager;
    gameAPI: GameAPI;
    getCurrentBetAmount?: () => number;
}

export class Menu {
    private menuContainer?: ButtonContainer;
    private contentArea: GameObjects.Container;
    private isMobile: boolean = true;
    private width: number = 0;
    private height: number = 0;
    private menuEventHandlers: Function[] = [];
    private menuGlobalCleanupFns: Array<() => void> = [];
    private isDraggingMusic: boolean = false;
    private isDraggingSFX: boolean = false;
    private scene: GameScene;
    public settingsOnly: boolean = false;

    private padding = 20;
    // Top padding for the whole menu panel so the in‑game clock remains visible
    private menuTopPadding: number = 20;
    private contentWidth = 1200;
    private yPosition = 0;
    private scrollView: GameObjects.Container;
    private contentContainer: GameObjects.Container;
    private isVisible: boolean = false;
    private panel: GameObjects.Container;
    private textHorizontalPadding?: number;
    
    // Tab content containers for proper tab switching
    private rulesContent: GameObjects.Container;
    private historyContent: GameObjects.Container;
    private settingsContent: GameObjects.Container;

    // Help screen
    private helpScreen?: HelpScreen;

    // History pagination state
    private historyCurrentPage: number = 1;
    private historyTotalPages: number = 1;
    private historyPageLimit: number = 11;
    private historyIsLoading: boolean = false;
    private historyHeaderContainer?: GameObjects.Container;
    private historyRowsContainer?: GameObjects.Container;
    private historyPaginationContainer?: GameObjects.Container;
    private historyTabContainer?: ButtonContainer;

    private readonly tabIconTargetHeight: number = 18;
    private readonly tabTextGapFromIcon: number = 8;
    private readonly tabTextDesiredFontSize: number = 16;
    private readonly tabTextMinFontSize: number = 1;
    private readonly tabDesiredPadding: number = 20;
    private readonly tabMinPadding: number = 12;

    private setHistoryTabEnabled(enabled: boolean): void {
        if (!this.historyTabContainer?.scene) {
            return;
        }
        this.historyTabContainer.setAlpha(enabled ? 1 : 0.5);
        if (this.historyTabContainer.input) {
            this.historyTabContainer.input.enabled = enabled;
        }
    }

    private fitTextToWidth(
        text: GameObjects.Text,
        maxWidth: number,
        desiredFontSize: number,
        minFontSize: number = 1
    ): void {
        const targetWidth = Math.max(0, maxWidth);
        const maxSize = Math.max(1, Math.floor(desiredFontSize));
        const minSize = Math.max(1, Math.floor(minFontSize));
        let currentSize = Math.max(minSize, maxSize);

        text.setFontSize(currentSize);
        while (text.width > targetWidth && currentSize > minSize) {
            currentSize -= 1;
            text.setFontSize(currentSize);
        }
    }

    private getTabIconKey(icon: string): string {
        const tabIconMap: Record<string, string> = {
            info: 'menu_info',
            history: 'menu_history',
            settings: 'menu_settings',
            close: 'menu_close'
        };
        return tabIconMap[icon] ?? '';
    }

    private createTabIcon(
        scene: GameScene,
        tabContainer: ButtonContainer,
        tabConfig: TabConfig,
        tabHeight: number
    ): ButtonImage | undefined {
        const iconKey = this.getTabIconKey(tabConfig.icon);
        if (!iconKey) {
            return undefined;
        }

        const icon = scene.add.image(0, tabHeight / 2, iconKey) as ButtonImage;
        icon.setOrigin(0, 0.5);
        const scale = this.tabIconTargetHeight / icon.height;
        icon.setScale(scale);

        if (tabConfig.icon === 'close') {
            icon.setOrigin(0.5, 0.5);
            icon.setPosition(tabConfig.width / 2, tabHeight / 2);
            icon.clearTint();
        } else {
            icon.setPosition(this.tabMinPadding, tabHeight / 2);
            icon.setTint(0x379557);
        }

        tabContainer.add(icon);
        return icon;
    }

    private createAndLayoutTabLabel(
        scene: GameScene,
        tabContainer: ButtonContainer,
        tabConfig: TabConfig,
        tabIcon: ButtonImage | undefined,
        tabHeight: number,
        isNormalTab: boolean
    ): void {
        const initialTextAreaLeft = isNormalTab
            ? (tabIcon ? tabIcon.x + tabIcon.displayWidth + this.tabTextGapFromIcon : this.tabDesiredPadding)
            : tabConfig.width / 2;
        const initialTextAreaWidth = isNormalTab
            ? Math.max(0, tabConfig.width - initialTextAreaLeft - this.tabDesiredPadding)
            : tabConfig.width;
        const textCenterX = isNormalTab
            ? initialTextAreaLeft + initialTextAreaWidth / 2
            : tabConfig.width / 2;

        const text = scene.add.text(textCenterX, tabHeight / 2, tabConfig.text, {
            fontSize: `${this.tabTextDesiredFontSize}px`,
            color: '#FFFFFF',
            fontFamily: 'Poppins-Regular',
            align: 'center'
        }) as ButtonText;

        if (tabConfig.icon === 'close') {
            text.setVisible(false);
        }
        text.setOrigin(0.5, 0.5);

        if (tabConfig.icon !== 'close') {
            text.setFontSize(this.tabTextDesiredFontSize);
            let resolvedPadding = this.tabDesiredPadding;
            let resolvedTextAreaLeft = initialTextAreaLeft;
            let resolvedTextAreaWidth = initialTextAreaWidth;

            for (let currentPadding = this.tabDesiredPadding; currentPadding >= this.tabMinPadding; currentPadding--) {
                if (tabIcon) {
                    tabIcon.setPosition(currentPadding, tabHeight / 2);
                    resolvedTextAreaLeft = tabIcon.x + tabIcon.displayWidth + this.tabTextGapFromIcon;
                } else {
                    resolvedTextAreaLeft = currentPadding;
                }

                const maxTextWidthAtPadding = Math.max(0, tabConfig.width - resolvedTextAreaLeft - currentPadding);
                resolvedPadding = currentPadding;
                resolvedTextAreaWidth = maxTextWidthAtPadding;
                text.setPosition(resolvedTextAreaLeft + maxTextWidthAtPadding / 2, tabHeight / 2);
                if (text.width <= maxTextWidthAtPadding) {
                    break;
                }
            }

            const maxTextWidth = Math.max(0, tabConfig.width - resolvedTextAreaLeft - resolvedPadding);
            this.fitTextToWidth(text, maxTextWidth, this.tabTextDesiredFontSize, this.tabTextMinFontSize);
            text.setPosition(resolvedTextAreaLeft + resolvedTextAreaWidth / 2, tabHeight / 2);
        }

        tabContainer.add(text);
    }

    protected titleStyle = {
        fontSize: '24px',
        color: '#379557',
        fontFamily: 'Poppins-Regular',
        fontStyle: 'bold'
    };

    protected header1Style = {
        fontSize: '24px',
        color: '#379557',
        fontFamily: 'Poppins-Bold',
        fontStyle: 'bold'
    };

    protected content1Style = {
        fontSize: '20px',
        color: '#FFFFFF',
        fontFamily: 'Poppins-Regular',
        align: 'left' as const
    };

    protected contentHeader1Style = {
        fontSize: '24px',
        color: '#FFFFFF',
        fontFamily: 'Poppins-Bold',
        align: 'left' as const
    };

    protected header2Style = {
        fontSize: '24px',
        color: '#379557',
        fontFamily: 'Poppins-Regular',
        fontStyle: 'bold'
    };

    protected textStyle = {
        fontSize: '20px',
        color: '#FFFFFF',
        fontFamily: 'Poppins-Regular',
        align: 'left',
        wordWrap: { width: this.contentWidth }
    };


    constructor(settingsOnly: boolean = false) {
        this.settingsOnly = settingsOnly;
    }

    private getMenuText(key: string): string {
        return localizationManager.getTextByKey(key) ?? LOCALIZATION_DEFAULTS[key] ?? key;
    }

    preload(scene: Scene){
        // No-op: menu assets are loaded via AssetLoader in Preloader
    }

    create(scene: GameScene){
        // No need to store scene reference
        this.contentContainer = scene.add.container(0, 0);
    }

    

    public createMenu(scene: GameScene): ButtonContainer {
        this.scene = scene; // Store scene reference
        this.width = scene.scale.width;
        this.height = scene.scale.height;

        // Create main menu container
        const menuContainer = scene.add.container(0, 0) as ButtonContainer;
        menuContainer.setDepth(2000);
        menuContainer.setVisible(false);
        menuContainer.setAlpha(0);

        // Create background overlay
        const bg = scene.add.graphics();
        bg.fillStyle(0x000000, 0.8);
        bg.fillRect(0, 0, this.width, this.height);
        // Make overlay interactive to block pointer events from reaching the game underneath
        bg.setInteractive(new Geom.Rectangle(0, 0, this.width, this.height), Geom.Rectangle.Contains);
        bg.on('pointerdown', () => {});
        bg.on('pointerup', () => {});
        menuContainer.add(bg);

        // Create menu panel - full screen background; top padding only affects tabs/content
        const panelWidth = this.width;
        const panelHeight = this.height;
        const panelX = 0;
        const panelY = 0;

        this.panel = scene.add.container(panelX, panelY) as ButtonContainer;
        menuContainer.add(this.panel);

        // Panel background - no border
        const panelBg = scene.add.graphics();
        panelBg.fillStyle(0x181818, 0.95);
        panelBg.fillRect(0, 0, panelWidth, panelHeight);
        // Make panel capture input too
        panelBg.setInteractive(new Geom.Rectangle(0, 0, panelWidth, panelHeight), Geom.Rectangle.Contains);
        panelBg.on('pointerdown', () => {});
        panelBg.on('pointerup', () => {});
        this.panel.add(panelBg);

        // Create tabs with different widths
        const tabHeight = 61;
        const smallTabScale = 0.5; // X tab will be half the width of normal tabs

        // Determine which tabs to show
        const baseIcons: string[] = this.settingsOnly
            ? ['settings']
            : ['info', 'history', 'settings'];

        const getLabel = (icon: string) => {
            switch (icon) {
                case 'info': return this.getMenuText(MENU_RULES);
                case 'history': return this.getMenuText(MENU_HISTORY);
                case 'settings': return this.getMenuText(COMMON_SETTINGS);
                case 'close': return 'X';
                default: return '';
            }
        };

        const normalTabCount = baseIcons.length;
        const totalTabUnits = normalTabCount + smallTabScale;
        const normalTabWidth = panelWidth / totalTabUnits;
        // Calculate close width to cover any rounding remainder to the panel edge
        const closeWidth = panelWidth - normalTabWidth * normalTabCount;

        // Original spacing: no inter-tab gaps; close tab is smaller on the right
        const tabConfigs: TabConfig[] = [
            ...baseIcons.map((icon, i) => ({ text: getLabel(icon), width: normalTabWidth, x: normalTabWidth * i, icon })),
            { text: getLabel('close'), width: closeWidth, x: normalTabWidth * normalTabCount, icon: 'close' }
        ];

        const tabContainers: ButtonContainer[] = [];
        this.historyTabContainer = undefined;

        tabConfigs.forEach((tabConfig, index) => {
            // Position tabs lower on screen to leave room for the clock at the top
            const tabContainer = scene.add.container(tabConfig.x, this.menuTopPadding) as ButtonContainer;
            
            // Tab background
            const tabBg = scene.add.graphics();
            const isClose = tabConfig.icon === 'close';

            tabBg.fillStyle(isClose ? 0x1F1F1F : 0x000000, 1); // Close has dark gray bg
            tabBg.fillRect(0, 0, tabConfig.width, tabHeight);
            tabContainer.add(tabBg);

            // Active tab indicator (green underline) - only for first tab initially
            const activeIndicator = scene.add.graphics();
            activeIndicator.fillStyle(0x00FF00, 1); // Bright green
            activeIndicator.fillRect(0, tabHeight - 3, tabConfig.width, 3);
            activeIndicator.setVisible(index === 0);
            tabContainer.add(activeIndicator);

            const tabIcon = this.createTabIcon(scene, tabContainer, tabConfig, tabHeight);
            this.createAndLayoutTabLabel(scene, tabContainer, tabConfig, tabIcon, tabHeight, index < normalTabCount);

            // Make tab interactive
            tabContainer.setInteractive(
                new Geom.Rectangle(0, 0, tabConfig.width, tabHeight),
                Geom.Rectangle.Contains
            ).isButton = true;

            const isHistoryTab = tabConfig.icon === 'history';
            const isCloseButton = tabConfig.icon === 'close';

            if (isHistoryTab) {
                this.historyTabContainer = tabContainer;
                this.setHistoryTabEnabled(false);
            }

            if (isCloseButton) {
                tabContainer.on('pointerup', () => {
                    scene.audioManager.playSoundEffect(SoundEffectType.MENU_CLICK);
                    this.hideMenu(scene);
                });
            } else {
                tabContainer.on('pointerup', () => {
                    scene.audioManager.playSoundEffect(SoundEffectType.MENU_CLICK);
                    this.switchTab(scene, tabContainers, index, tabConfigs);
                });
            }

            tabContainers.push(tabContainer);
            this.panel.add(tabContainer);
        });

        // Set initial active tab highlight
        this.switchTab(scene, tabContainers, 0, tabConfigs);

        // Create content area with mask to prevent overlap with tabs
        // Position is offset by menuTopPadding so tab content sits below the clock area
        const contentArea = scene.add.container(20, this.menuTopPadding + tabHeight + 20);
        contentArea.setSize(
            panelWidth - 40,
       panelHeight - this.menuTopPadding - tabHeight - 40
        );
        
        // Create mask for content area to prevent overlap with tabs
        const contentMask = scene.add.graphics();
        contentMask.fillStyle(0xffffff);
        // Mask starts just under the tabs, including the top menu padding
        const maskTop = this.menuTopPadding + (tabHeight - 1);
        const maskHeight = panelHeight - maskTop;
        contentMask.fillRect(0, maskTop, panelWidth, maskHeight);
        const geometryMask = contentMask.createGeometryMask();
        contentArea.setMask(geometryMask);
        contentMask.setVisible(false); // Hide the mask graphics
        
        this.panel.add(contentArea);

        // Store content area reference
        this.contentArea = contentArea;

        // Initialize tab content containers
        this.initializeTabContentContainers(scene);

        // Show initial content based on first tab
        this.showTabContent(scene, tabConfigs[0].icon);

        // Store menu container reference
        this.menuContainer = menuContainer;

        return menuContainer;
    }

    private initializeTabContentContainers(scene: GameScene): void {
        // Create separate containers for each tab's content
        this.rulesContent = scene.add.container(0, 0);
        this.historyContent = scene.add.container(0, 0);
        this.settingsContent = scene.add.container(0, 0);
        
        // Add all containers to the content area
        this.contentArea.add(this.rulesContent);
        this.contentArea.add(this.historyContent);
        this.contentArea.add(this.settingsContent);
        
        // Initialize content for each tab
        // Help / Rules content is delegated to HelpScreen
        const resolveBetAmount = scene.getCurrentBetAmount?.bind(scene) ?? (() => 1);
        this.helpScreen = new HelpScreen(
            scene,
            this.contentArea,
            this.rulesContent,
            {
                titleStyle: this.titleStyle,
                header1Style: this.header1Style,
                header2Style: this.header2Style,
                content1Style: this.content1Style,
                contentHeader1Style: this.contentHeader1Style,
                textStyle: this.textStyle,
            },
            () => this.isVisible,
            resolveBetAmount
        );
        this.helpScreen.build();
        this.historyCurrentPage = 1;
        this.historyPageLimit = 11;
        this.showHistoryContent(scene, this.historyCurrentPage, this.historyPageLimit);
        this.createVolumeSettingsContent(scene, this.settingsContent);
        
        // Initially hide all except rules
        this.hideAllTabContent();
        this.rulesContent.setVisible(true);
    }

    private hideAllTabContent(): void {
        this.rulesContent.setVisible(false);
        this.historyContent.setVisible(false);
        this.settingsContent.setVisible(false);
    }

    private switchTab(scene: GameScene, tabContainers: ButtonContainer[], activeIndex: number, tabConfigs: TabConfig[]): void {
        // Check if demo mode is active and prevent switching to history tab
        const isDemo = scene.gameAPI?.getDemoState();
        const tabKey: string = tabConfigs[activeIndex].icon;

        if (isDemo && tabKey === 'history') {
            // Don't switch to history tab in demo mode - stay on current tab or switch to first available tab
            const firstNonHistoryIndex = tabConfigs.findIndex((config, idx) => config.icon !== 'history' && config.icon !== 'close');
            if (firstNonHistoryIndex !== -1) {
                activeIndex = firstNonHistoryIndex;
            }
        }

        // Update tab highlighting
        tabContainers.forEach((tabContainer, index) => {
            const tabBg = tabContainer.getAt(0) as GameObjects.Graphics;
            const activeIndicator = tabContainer.getAt(1) as GameObjects.Graphics;
            const tabConfig = tabConfigs[index];
            
            if (index === activeIndex) {
                // Active tab: dark green background with bright green underline
                tabBg.fillStyle(0x2D5A3D, 1); // Dark green background
                tabBg.fillRect(0, 0, tabConfig.width, 61);
                activeIndicator.setVisible(true);
            } else {
                // Inactive tab: black background, no underline
                tabBg.fillStyle(tabConfig.icon === 'close' ? 0x1F1F1F : 0x000000);
                tabBg.fillRect(0, 0, tabConfig.width, 61);
                activeIndicator.setVisible(false);
            }
        });

        // Show content for active tab
        const finalTabKey: string = tabConfigs[activeIndex].icon;
        this.showTabContent(scene, finalTabKey);
    }

    private showTabContent(scene: GameScene, tabKey: string): void {
        if (!this.contentArea) return;
        
        this.hideAllTabContent();

        switch (tabKey) {
            case 'info':
                this.rulesContent.setVisible(true);
                break;
            case 'history':
                this.historyContent.setVisible(true);
                break;
            case 'settings':
                this.settingsContent.setVisible(true);
                break;
            case 'close':
                this.hideMenu(scene);
                break;
        }
    }



    private async showHistoryContent(scene: GameScene, page: number, limit: number): Promise<void> {
        const contentArea = this.historyContent;
        // Keep old rows until new data is ready; build containers on first run
        const historyHeaders : string[] = ['Spin', 'Currency', 'Bet', 'Win'];
        // Check if demo mode is active
        const isDemo = scene.gameAPI?.getDemoState();
        // Recreate or reparent containers if needed (handles menu reopen)
        if (!this.historyHeaderContainer || !this.historyHeaderContainer.scene) {
            this.historyHeaderContainer = scene.add.container(0, 0);
            const historyText = scene.add.text(15, 15,'History', this.titleStyle) as ButtonText;
            historyText.setOrigin(0, 0);
            this.historyHeaderContainer.add(historyText);
        }
        // Recreate rows and pagination containers fresh to avoid recursive destroy issues
        if (this.historyRowsContainer && this.historyRowsContainer.scene) {
            this.historyRowsContainer.destroy(true);
        }
        this.historyRowsContainer = scene.add.container(0, 0);
        if ((this.historyRowsContainer as any).parentContainer !== contentArea) {
            contentArea.add(this.historyRowsContainer);
        }

        if (this.historyPaginationContainer && this.historyPaginationContainer.scene) {
            this.historyPaginationContainer.destroy(true);
        }
        this.historyPaginationContainer = scene.add.container(0, 0);
        if ((this.historyPaginationContainer as any).parentContainer !== contentArea) {
            contentArea.add(this.historyPaginationContainer);
        }
        if ((this.historyHeaderContainer as any).parentContainer !== contentArea) {
            contentArea.add(this.historyHeaderContainer);
        }

        // In demo mode, show empty history without making API call
        if (isDemo) {
            // Display headers centered per column (only once)
            const columnCenters = this.getHistoryColumnCenters(scene);
            const headerContainer = this.historyHeaderContainer as GameObjects.Container;
            if (headerContainer.length <= 1) { // only title exists
                const headerY = 60;
                historyHeaders.forEach((header, idx) => {
                    const headerText = scene.add.text(columnCenters[idx], headerY, header, {
                        fontSize: '14px',
                        color: '#FFFFFF',
                        fontFamily: 'Poppins-Regular',
                        fontStyle: 'bold',
                    }) as ButtonText;
                    headerText.setOrigin(0.5, 0);
                    headerContainer.add(headerText);
                });
            }

            // Show empty state message
            const emptyMessage = scene.add.text(
                scene.scale.width / 2,
                scene.scale.height * 0.3,
                'History is not available in demo mode',
                {
                    fontSize: '16px',
                    color: '#888888',
                    fontFamily: 'Poppins-Regular',
                }
            ) as ButtonText;
            emptyMessage.setOrigin(0.5, 0.5);
            this.historyRowsContainer.add(emptyMessage);

            // No pagination in demo mode
            return;
        }

        // Prevent stacking requests
        if (this.historyIsLoading) {
            return;
        }
        this.historyIsLoading = true;

        // Show loading icon while fetching history (centered on screen)
        const loaderX = scene.scale.width * 0.45;
        const loaderY = scene.scale.height * 0.3;
        const loader = scene.add.image(loaderX, loaderY, 'loading_icon') as ButtonImage;
        loader.setOrigin(0.5, 0.5);
        loader.setScale(0.25);
        contentArea.add(loader);
        const spinTween = scene.tweens.add({
            targets: loader,
            angle: 360,
            duration: 800,
            repeat: -1,
            ease: 'Linear'
        });

        let result: any;
        try {
            result = await scene.gameAPI.getHistory(page, limit);
            if (result && result.data && result.data.length > 0) {
                this.setHistoryTabEnabled(true);
            }
        } finally {
            spinTween.stop();
            loader.destroy();
            this.historyIsLoading = false;
        }
        
        console.log('History API Response:', result);

        // Update pagination state - check multiple possible metadata formats
        this.historyCurrentPage = result?.meta?.page ?? result?.page ?? result?.meta?.currentPage ?? page;
        this.historyTotalPages = result?.meta?.pageCount ?? result?.totalPages ?? result?.meta?.totalPages ?? result?.meta?.total ?? 1;
        this.historyPageLimit = limit;
        
        console.log('Pagination State:', {
            currentPage: this.historyCurrentPage,
            totalPages: this.historyTotalPages,
            limit: this.historyPageLimit
        });
        
        // Display headers centered per column (only once)
        const columnCenters = this.getHistoryColumnCenters(scene);
        const headerContainer = this.historyHeaderContainer as GameObjects.Container;
        // When reopening, header could have been destroyed; rebuild if empty or missing headers
        if (headerContainer.length <= 1) { // only title exists
            const headerY = 60;
            historyHeaders.forEach((header, idx) => {
                const headerText = scene.add.text(columnCenters[idx], headerY, header, {
                    fontSize: '14px',
                    color: '#FFFFFF',
                    fontFamily: 'Poppins-Regular',
                    fontStyle: 'bold',
                }) as ButtonText;
                headerText.setOrigin(0.5, 0);
                headerContainer.add(headerText);
            });
        }

        let spinDate = '26/7/2025, 16:00';
        let currency = 'usd';
        let bet = '250.00';
        let win = 250000000;

        let contentY = 100;
        const rowsContainer = this.historyRowsContainer as GameObjects.Container;
        result.data?.forEach((v?:any)=>{
            spinDate = this.formatISOToDMYHM(v.createdAt);
            currency = v.currency == ''?'usd':v.currency;
            const betAmount = Number(v.bet);
            const winAmount = Number(v.win);

            bet = formatCurrencyNumber(Number.isFinite(betAmount) ? betAmount : 0);
            win = Number.isFinite(winAmount) ? winAmount : 0;

            contentY += 30;
            // Create row centered per column
            this.createHistoryEntry(contentY, scene, rowsContainer, spinDate, currency, bet, formatCurrencyNumber(Number(win)), columnCenters);
            this.addDividerHistory(scene, rowsContainer, contentY);
            contentY += 20;
        });
        
        // Add pagination buttons at bottom-center
        const paginationContainer = this.historyPaginationContainer as GameObjects.Container;
        this.addHistoryPagination(scene, paginationContainer, this.historyCurrentPage, this.historyTotalPages, this.historyPageLimit);
    }

    private formatISOToDMYHM(iso: string, timeZone = 'Asia/Manila'): string {
        const d = new Date(iso);
        const parts = new Intl.DateTimeFormat('en-GB', {
          day: 'numeric',        // no leading zero
          month: 'numeric',      // no leading zero
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone,
        }).formatToParts(d);
      
        const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
        return `${map.day}/${map.month}/${map.year}, ${map.hour}:${map.minute}`;
      }
      

    private createHistoryEntry(y: number, scene: GameScene, contentArea: GameObjects.Container, spinDate: string, currency: string, bet: string, win: string, columnCenters: number[]): void {
        // Create separate text fields and center them per column
        const values: string[] = [spinDate, currency, bet, win];
        values.forEach((value, idx) => {
            const text = scene.add.text(columnCenters[idx], y, value, {
                fontSize: '14px',
                color: '#FFFFFF',
                fontFamily: 'Poppins-Regular',
            }) as ButtonText;
            text.setOrigin(0.5, 0);
            contentArea.add(text);
        });
    }

    // Compute four column centers within the content area bounds
    private getHistoryColumnCenters(scene: GameScene): number[] {
        const worldLeft = 20;
        const worldRight = scene.scale.width - 20;
        const parentOffsetX = this.contentArea ? this.contentArea.x : 0;
        const localLeft = worldLeft - parentOffsetX;
        const localRight = worldRight - parentOffsetX;
        const totalWidth = localRight - localLeft;

        // Define column center ratios across the available width (tuned for headers)
        const ratios = [0.15, 0.40, 0.65, 0.88];
        return ratios.map(r => localLeft + totalWidth * r);
    }

    private addDividerHistory(scene: GameScene, contentArea: GameObjects.Container, y: number): void {
        const dividerY = y + 30;
        const worldLeft = 20;
        const worldRight = scene.scale.width - 20;
        const parentOffsetX = this.contentArea ? this.contentArea.x : 0;
        const localLeft = worldLeft - parentOffsetX;
        const localWidth = worldRight - worldLeft;
        const divider = scene.add.graphics();
        divider.fillStyle(0xFFFFFF, 0.1);
        divider.fillRect(localLeft, dividerY, localWidth, 1);
        contentArea.add(divider);
    }

    private addHistoryPagination(scene: GameScene, contentArea: GameObjects.Container, page: number, totalPages: number, limit: number): void {
        const buttonSpacing = 18;
        const icons = ['icon_most_left', 'icon_left', 'icon_right', 'icon_most_right'];

        // Use the actual content area dimensions (parent container) for placement
        const areaWidth = this.contentArea ? this.contentArea.width : scene.scale.width;
        const areaHeight = this.contentArea ? this.contentArea.height : scene.scale.height;

        // Bottom within the visible content area
        const bottomPadding = 80;
        const y = areaHeight - bottomPadding;

        // Measure total width for centering within the content area
        const tempImages: Phaser.GameObjects.Image[] = icons.map(key => scene.add.image(0, 0, key) as ButtonImage);
        const totalWidth = tempImages.reduce((sum, img, i) => sum + img.width + (i > 0 ? buttonSpacing : 0), 0);
        tempImages.forEach(img => img.destroy());

        // Start X so the row is centered inside the content area's local coordinates
        let currentX = (areaWidth - totalWidth) / 2;

        // Place interactive buttons into the history content container
        icons.forEach((key) => {
            const btn = scene.add.image(currentX, y, key) as ButtonImage;
            btn.setOrigin(0, 1);

            let targetPage = page;
            let enabled = true;
            switch (key) {
                case 'icon_most_left':
                    targetPage = 1;
                    enabled = page > 1;
                    break;
                case 'icon_left':
                    targetPage = Math.max(1, page - 1);
                    enabled = page > 1;
                    break;
                case 'icon_right':
                    targetPage = Math.min(totalPages, page + 1);
                    enabled = page < totalPages;
                    break;
                case 'icon_most_right':
                    targetPage = Math.max(1, totalPages);
                    enabled = page < totalPages;
                    break;
            }

            if (enabled) {
                btn.setInteractive({ useHandCursor: true });
                btn.on('pointerup', () => {
                    if (this.historyIsLoading) { return; }
                    scene.audioManager.playSoundEffect(SoundEffectType.MENU_CLICK);
                    // Disable all pagination buttons during load
                    contentArea.iterate((child: Phaser.GameObjects.GameObject) => {
                        const img = child as Phaser.GameObjects.Image;
                        if (img && (img as any).texture && icons.includes((img as any).texture.key)) {
                            img.disableInteractive();
                            img.setAlpha(0.5);
                        }
                    });
                    this.showHistoryContent(scene, targetPage, limit);
                });
            } else {
                btn.setAlpha(0.5);
                btn.disableInteractive();
            }

            contentArea.add(btn);
            currentX += btn.width + buttonSpacing;
        });

        // Page number display: "Page 1 of 10"
        const pageNumberText = scene.add.text(
            areaWidth / 2,
            y + 40, // place below the pagination buttons
            `Page ${page} of ${totalPages}`,
            {
                fontSize: '20px',
                color: '#FFFFFF',
                fontFamily: 'Poppins-Regular',
                align: 'center'
            }
        ) as ButtonText;
        pageNumberText.setOrigin(0.5, 0); // center horizontally
        contentArea.add(pageNumberText);
    }



    private createVolumeSettingsContent(scene: GameScene, contentArea: GameObjects.Container): void {
        const scaleFactor = 1;
        const widthSlider = 340;

        // Title - Settings in green color #379557
        const title = scene.add.text(15, 15, this.getMenuText(COMMON_SETTINGS), this.titleStyle) as ButtonText;
        title.setOrigin(0, 0);
        contentArea.add(title);

        // Calculate proper positions
        const startX = 15;
        const startY = 15;
        const sliderStartX = startX;
        const musicSliderY = startY + 115;
        // Match Zero Law SFX layout
        const sfxSliderY = startY + 240;

        // Music section (no icon)
        const musicLabel = scene.add.text(startX + 0, startY + 70, this.getMenuText(MENU_BACKGROUND_MUSIC), {
            fontSize: '18px',
            color: '#FFFFFF',
            fontFamily: 'Poppins-Regular'
        }) as ButtonText;
        contentArea.add(musicLabel);

        // SFX section (no icon)
        const sfxLabel = scene.add.text(startX + 0, startY + 190, this.getMenuText(MENU_SOUND_FX), {
            fontSize: '18px',
            color: '#FFFFFF',
            fontFamily: 'Poppins-Regular'
        }) as ButtonText;
        contentArea.add(sfxLabel);

        // Toggle switches (right side)
        const toggleWidth = 64;
        const toggleHeight = 36;
        const toggleRadius = 18;
        // Place toggles within the visible content area width (panel width - 40 padding)
        const contentAreaWidth = scene.scale.width - 40;
        const toggleX = Math.max(sliderStartX + 200, contentAreaWidth - toggleWidth - 20);

        const drawToggle = (bg: Phaser.GameObjects.Graphics, circle: Phaser.GameObjects.Graphics, x: number, yCenter: number, on: boolean) => {
            const y = yCenter - toggleHeight / 2;
            bg.clear();
            circle.clear();
            if (on) {
                // ON: green track; white knob on RIGHT
                bg.fillStyle(0x379557, 1);
                bg.lineStyle(3, 0x2F6D49, 1);
                bg.strokeRoundedRect(x, y, toggleWidth, toggleHeight, toggleRadius);
                bg.fillRoundedRect(x, y, toggleWidth, toggleHeight, toggleRadius);
                circle.fillStyle(0xFFFFFF, 1);
                circle.fillCircle(x + toggleWidth - toggleRadius, y + toggleHeight / 2, toggleRadius - 4);
            } else {
                // OFF: dark gray track; white knob on LEFT
                bg.fillStyle(0x1F2937, 1);
                bg.lineStyle(3, 0x9CA3AF, 1);
                bg.strokeRoundedRect(x, y, toggleWidth, toggleHeight, toggleRadius);
                bg.fillRoundedRect(x, y, toggleWidth, toggleHeight, toggleRadius);
                circle.fillStyle(0xFFFFFF, 1);
                circle.fillCircle(x + toggleRadius, y + toggleHeight / 2, toggleRadius - 4);
            }
        };

        // Music toggle
        const musicToggleBg = scene.add.graphics();
        const musicToggleCircle = scene.add.graphics();
        contentArea.add(musicToggleBg);
        contentArea.add(musicToggleCircle);
        musicToggleBg.setDepth(10);
        musicToggleCircle.setDepth(11);
        // Reflect current volume; do not overwrite user's choice when opening menu
        let musicOn = scene.audioManager.getVolume() > 0;
        drawToggle(musicToggleBg, musicToggleCircle, toggleX, startY + 70, musicOn);
        const musicToggleArea = scene.add.zone(toggleX, startY + 70 - toggleHeight / 2, toggleWidth, toggleHeight).setOrigin(0, 0);
        musicToggleArea.setInteractive();
        try { if ((musicToggleArea as any).input) (musicToggleArea as any).input.priorityID = 10; } catch {}
        musicToggleArea.on('pointerdown', () => {
            musicOn = !musicOn;
            scene.audioManager.setVolume(musicOn ? 1 : 0);
            drawToggle(musicToggleBg, musicToggleCircle, toggleX, startY + 70, musicOn);
            updateSliders();
        });
        contentArea.add(musicToggleArea);
        musicToggleArea.setDepth(12);

        // SFX toggle
        const sfxToggleBg = scene.add.graphics();
        const sfxToggleCircle = scene.add.graphics();
        contentArea.add(sfxToggleBg);
        contentArea.add(sfxToggleCircle);
        sfxToggleBg.setDepth(10);
        sfxToggleCircle.setDepth(11);
        // Reflect current SFX volume; do not overwrite user's choice when opening menu
        let sfxOn = scene.audioManager.getSfxVolume() > 0;
        drawToggle(sfxToggleBg, sfxToggleCircle, toggleX, startY + 190, sfxOn);
        const sfxToggleArea = scene.add.zone(toggleX, startY + 190 - toggleHeight / 2, toggleWidth, toggleHeight).setOrigin(0, 0);
        sfxToggleArea.setInteractive();
        try { if ((sfxToggleArea as any).input) (sfxToggleArea as any).input.priorityID = 10; } catch {}
        sfxToggleArea.on('pointerdown', () => {
            sfxOn = !sfxOn;
            scene.audioManager.setSfxVolume(sfxOn ? 1 : 0);
            drawToggle(sfxToggleBg, sfxToggleCircle, toggleX, startY + 190, sfxOn);
            updateSliders();
        });
        contentArea.add(sfxToggleArea);
        sfxToggleArea.setDepth(12);

                // Music slider background
        const musicSliderBg = scene.add.graphics();
        musicSliderBg.fillStyle(0x379557, 1);
        musicSliderBg.fillRoundedRect(sliderStartX, musicSliderY, widthSlider * scaleFactor, 8 * scaleFactor, 4 * scaleFactor);
        
        const musicSliderBg2 = scene.add.graphics();
        musicSliderBg2.fillStyle(0x333333, 1);
        musicSliderBg2.lineStyle(1, 0x666666);
        musicSliderBg2.fillRoundedRect(sliderStartX, musicSliderY, widthSlider * scaleFactor, 8 * scaleFactor, 4 * scaleFactor);
        musicSliderBg2.strokeRoundedRect(sliderStartX, musicSliderY, widthSlider * scaleFactor, 8 * scaleFactor, 4 * scaleFactor);
        
        contentArea.add(musicSliderBg2);
        contentArea.add(musicSliderBg);

        const musicSlider = scene.add.graphics();
        musicSlider.fillStyle(0xffffff, 1);
        // Draw knob at local origin and position the graphics instead of drawing at world coords
        musicSlider.fillCircle(0, 0, 12 * scaleFactor);
        musicSlider.setPosition(sliderStartX + scene.audioManager.getVolume() * widthSlider * scaleFactor, musicSliderY + 4);
        // Enlarge interactive hit area and keep it local to the graphics
        musicSlider.setInteractive(
            new Geom.Circle(0, 0, 22 * scaleFactor),
            Geom.Circle.Contains
        );
        try { if ((musicSlider as any).input) (musicSlider as any).input.priorityID = 10; } catch {}
        contentArea.add(musicSlider);

        // Music value text
        const musicValue = scene.add.text(sliderStartX , musicSliderY + 25, Math.round(scene.audioManager.getVolume() * 100) + '%', {
            fontSize: '16px',
            color: '#FFFFFF',
            fontFamily: 'Poppins-Regular'
        }) as ButtonText;
        contentArea.add(musicValue);

        // SFX slider (mirrors music slider styling)
        const sfxSliderBg = scene.add.graphics();
        const sfxSliderBg2 = scene.add.graphics();
        const sfxSlider = scene.add.graphics();
        const sfxValue = scene.add.text(sliderStartX, sfxSliderY + 25, Math.round(scene.audioManager.getSfxVolume() * 100) + '%', {
            fontSize: '16px',
            color: '#FFFFFF',
            fontFamily: 'Poppins-Regular'
        }) as ButtonText;
        // Background (filled portion) for SFX slider
        sfxSliderBg.fillStyle(0x379557, 1);
        sfxSliderBg.fillRoundedRect(sliderStartX, sfxSliderY, widthSlider * scaleFactor, 8 * scaleFactor, 4 * scaleFactor);
        // Full track background / border for SFX slider
        sfxSliderBg2.fillStyle(0x333333, 1);
        sfxSliderBg2.lineStyle(1, 0x666666);
        sfxSliderBg2.fillRoundedRect(sliderStartX, sfxSliderY, widthSlider * scaleFactor, 8 * scaleFactor, 4 * scaleFactor);
        sfxSliderBg2.strokeRoundedRect(sliderStartX, sfxSliderY, widthSlider * scaleFactor, 8 * scaleFactor, 4 * scaleFactor);
        contentArea.add(sfxSliderBg2);
        contentArea.add(sfxSliderBg);
        contentArea.add(sfxSlider);
        contentArea.add(sfxValue);

        // Helper to update slider positions and values
        const updateSliders = (musicX: number | null = null, sfxX: number | null = null) => {
            const sliderWidth = widthSlider * scaleFactor;

            const musicVol = musicX !== null ? 
                Math.max(0, Math.min(1, musicX / sliderWidth)) : 
                scene.audioManager.getVolume();
            
            const sfxVol = sfxX !== null ? 
                Math.max(0, Math.min(1, sfxX / sliderWidth)) : 
                scene.audioManager.getSfxVolume();
            
            // Update music slider
            musicSlider.clear();
            musicSlider.fillStyle(0xffffff, 1);
            const musicSliderX = sliderStartX + (musicVol * sliderWidth);
            // Keep drawing local and move the graphics to the new position
            musicSlider.fillCircle(0, 0, 12 * scaleFactor);
            musicSlider.setPosition(musicSliderX, musicSliderY + 4);
            musicSliderBg.clear();
            musicSliderBg.fillStyle(0x379557, 1);
            musicSliderBg.fillRoundedRect(sliderStartX, musicSliderY, sliderWidth * musicVol, 8 * scaleFactor, 4 * scaleFactor);
            musicValue.setText(Math.round(musicVol * 100) + '%');

            // Sync music toggle state with displayed percent (0% OFF, 1%+ ON)
            if (Math.round(musicVol * 100) < 1) {
                if (musicOn) {
                    musicOn = false;
                    drawToggle(musicToggleBg, musicToggleCircle, toggleX, startY + 70, musicOn);
                }
            } else {
                if (!musicOn) {
                    musicOn = true;
                    drawToggle(musicToggleBg, musicToggleCircle, toggleX, startY + 70, musicOn);
                }
            }
            
            // Update SFX slider
            const sfxSliderX = sliderStartX + (sfxVol * sliderWidth);
            sfxSlider.clear();
            sfxSlider.fillStyle(0xffffff, 1);
            sfxSlider.fillCircle(0, 0, 12 * scaleFactor);
            sfxSlider.setPosition(sfxSliderX, sfxSliderY + 4);
            sfxSliderBg.clear();
            sfxSliderBg.fillStyle(0x379557, 1);
            sfxSliderBg.fillRoundedRect(sliderStartX, sfxSliderY, sliderWidth * sfxVol, 8 * scaleFactor, 4 * scaleFactor);
            sfxValue.setText(Math.round(sfxVol * 100) + '%');

            if (Math.round(sfxVol * 100) < 1) {
                if (sfxOn) {
                    sfxOn = false;
                    drawToggle(sfxToggleBg, sfxToggleCircle, toggleX, startY + 190, sfxOn);
                }
            } else {
                if (!sfxOn) {
                    sfxOn = true;
                    drawToggle(sfxToggleBg, sfxToggleCircle, toggleX, startY + 190, sfxOn);
                }
            }

            // Update volumes
            if (musicX !== null) scene.audioManager.setVolume(musicVol);
            if (sfxX !== null) scene.audioManager.setSfxVolume(sfxVol);

            // Update interactive areas for sliders (keep hit areas centered on the local origin)
            musicSlider.setInteractive(
                new Geom.Circle(0, 0, 22 * scaleFactor),  
                Geom.Circle.Contains
            );
            try { if ((musicSlider as any).input) (musicSlider as any).input.priorityID = 10; } catch {}
            sfxSlider.setInteractive(
                new Geom.Circle(0, 0, 22 * scaleFactor),
                Geom.Circle.Contains
            );
            try { if ((sfxSlider as any).input) (sfxSlider as any).input.priorityID = 10; } catch {}
        };

        // Initial slider setup
        updateSliders();


        // Make sliders draggable
        this.isDraggingMusic = false;
        this.isDraggingSFX = false;

        // Global pointer move and up handlers
        const pointerMoveHandler = (pointer: Phaser.Input.Pointer) => {
            if (this.isDraggingMusic) {
                const sliderWidth = widthSlider * scaleFactor;
                const p = (musicSliderTrack as any).getLocalPoint(pointer.worldX, pointer.worldY);
                const localX = Math.max(0, Math.min(sliderWidth, p && typeof p.x === 'number' ? p.x : 0));
                updateSliders(localX, null);
            } else if (this.isDraggingSFX) {
                const sliderWidth = widthSlider * scaleFactor;
                const p = (sfxSliderTrack as any).getLocalPoint(pointer.worldX, pointer.worldY);
                const localX = Math.max(0, Math.min(sliderWidth, p && typeof p.x === 'number' ? p.x : 0));
                updateSliders(null, localX);
            }
        };

        const pointerUpHandler = () => {
            this.isDraggingMusic = false;
            this.isDraggingSFX = false;
        };

        // Store handlers for cleanup
        this.menuEventHandlers.push(pointerMoveHandler, pointerUpHandler);

        this.scene.input.on('pointermove', pointerMoveHandler);
        this.scene.input.on('pointerup', pointerUpHandler);
        try {
            this.scene.input.on('gameout', pointerUpHandler);
            this.menuGlobalCleanupFns.push(() => {
                try { this.scene.input.off('gameout', pointerUpHandler); } catch {}
            });
        } catch {}
        try {
            const endDrag = () => pointerUpHandler();
            window.addEventListener('mouseup', endDrag);
            window.addEventListener('blur', endDrag);
            document.addEventListener('visibilitychange', endDrag);
            this.menuGlobalCleanupFns.push(() => {
                try { window.removeEventListener('mouseup', endDrag); } catch {}
                try { window.removeEventListener('blur', endDrag); } catch {}
                try { document.removeEventListener('visibilitychange', endDrag); } catch {}
            });
        } catch {}

        // Create clickable areas for the entire slider tracks
        const musicSliderTrack = scene.add.graphics();
        musicSliderTrack.setPosition(sliderStartX, musicSliderY);
        musicSliderTrack.fillStyle(0x000000, 0); // Transparent
        // Draw and set hit area in local coords for reliable input inside a container
        musicSliderTrack.fillRect(0, -10, widthSlider * scaleFactor, 28);
        musicSliderTrack.setInteractive(
            new Geom.Rectangle(0, -10, widthSlider * scaleFactor, 28),
            Geom.Rectangle.Contains
        );
        contentArea.add(musicSliderTrack);

        const sfxSliderTrack = scene.add.graphics();
        sfxSliderTrack.setPosition(sliderStartX, sfxSliderY);
        sfxSliderTrack.fillStyle(0x000000, 0); // Transparent
        // Draw and set hit area in local coords for reliable input inside a container
        sfxSliderTrack.fillRect(0, -10, widthSlider * scaleFactor, 28);
        sfxSliderTrack.setInteractive(
            new Geom.Rectangle(0, -10, widthSlider * scaleFactor, 28),
            Geom.Rectangle.Contains
        );
        contentArea.add(sfxSliderTrack);

        // Music slider track click handler
        musicSliderTrack.on('pointerdown', (pointer: Phaser.Input.Pointer, localX: number) => {
            const sliderWidth = widthSlider * scaleFactor;
            localX = Math.max(0, Math.min(sliderWidth, localX));
            const newVolume = localX / sliderWidth;
            scene.audioManager.setVolume(newVolume);
            this.isDraggingMusic = true; // allow click-and-drag on the track
            updateSliders();
        });

        // SFX slider track click handler
        sfxSliderTrack.on('pointerdown', (pointer: Phaser.Input.Pointer, localX: number) => {
            const sliderWidth = widthSlider * scaleFactor;
            localX = Math.max(0, Math.min(sliderWidth, localX));
            const newVolume = localX / sliderWidth;
            scene.audioManager.setSfxVolume(newVolume);
            this.isDraggingSFX = true;
            updateSliders();
        });

        // Music slider handle interaction
        musicSlider.on('pointerdown', () => {
            this.isDraggingMusic = true;
        });

        // SFX slider handle interaction
        sfxSlider.on('pointerdown', () => {
            this.isDraggingSFX = true;
        });
    }

    public showMenu(scene: GameScene): void {
        // Idempotent: rapid menu-button clicks during the 300ms fade-in can race
        // past the new overlay's hit-test and stack a second menu. Stale instances
        // leak in the display list and make the Close tab appear to be a no-op
        // (hideMenu only acts on `this.menuContainer`, the latest reference).
        if (this.isVisible && this.menuContainer && this.menuContainer.active) {
            return;
        }

        // Defensive: tear down any leftover container before creating a fresh one
        // (covers edge cases where isVisible is false but the previous container
        // is still in the display list).
        if (this.menuContainer) {
            this.hideMenu(scene);
            this.menuContainer.destroy(true);
            this.menuContainer = undefined;
        }

        this.settingsOnly = false;

        const container = this.createMenu(scene);

        container.setVisible(true);
        container.setAlpha(0);
        this.isVisible = true;
        
        scene.tweens.add({
            targets: container,
            alpha: 1,
            duration: 300,
            ease: 'Power2'
        });

    }

    /** Whether the in-game menu panel is currently shown. */
    public isMenuVisible(): boolean {
        return this.isVisible;
    }

    public hideMenu(scene: GameScene): void {
        if (!this.menuContainer) return;
        
        // Ensure menu container and all its children are hidden
        this.menuContainer.setVisible(false);
        this.menuContainer.setActive(false);
        this.isVisible = false;
        
        // Reset any help screen related state if present (guarded)
        if ((scene.gameData as any).isHelpScreenVisible !== undefined) {
            (scene.gameData as any).isHelpScreenVisible = false;
        }
        
        // Clean up event handlers
        if (this.menuEventHandlers) {
            this.menuEventHandlers.forEach(handler => {
                scene.input.off('pointermove', handler);
                scene.input.off('pointerup', handler);
            });
            this.menuEventHandlers = [];
        }
        if (this.menuGlobalCleanupFns) {
            this.menuGlobalCleanupFns.forEach((off) => {
                try { off(); } catch {}
            });
            this.menuGlobalCleanupFns = [];
        }
        
        // Reset dragging states
        this.isDraggingMusic = false;
        this.isDraggingSFX = false;
    }

    private destroyMenu(scene: GameScene): void {
        // Hide and cleanup listeners first
        this.hideMenu(scene);
        // Destroy existing container to free resources
        if (this.menuContainer) {
            this.menuContainer.destroy(true);
            this.menuContainer = undefined;
        }
        this.panel = undefined as any;
    }



    private addContent(scene: GameScene, _text: string, _type: string, _wordWrap: boolean = false, _wordWrapWidth: number = 0): void {
        if (_type === 'title') {
            const content = scene.add.text((this.textHorizontalPadding ?? this.padding / 2), this.yPosition, _text, this.titleStyle as Phaser.Types.GameObjects.Text.TextStyle);
            this.contentContainer.add(content);
            if (_text === 'Bonus Trigger') {
                content.setPosition(0, content.y);
            }
            this.yPosition += content.height + this.padding;
        } else if (_type === 'text') {
            const style = { ...this.textStyle } as Phaser.Types.GameObjects.Text.TextStyle;
            if (_wordWrap) {
                // wordWrap should be an object, not undefined
                style.wordWrap = { width: _wordWrapWidth };
            }
            const content = scene.add.text((this.textHorizontalPadding ?? this.padding / 2), this.yPosition, _text, style);
            this.contentContainer.add(content);
            this.yPosition += content.height + this.padding;
        } else if (_type === 'contentHeader1') {
            const style = { ...this.contentHeader1Style } as Phaser.Types.GameObjects.Text.TextStyle;
            if (_wordWrap) {
                style.wordWrap = { width: _wordWrapWidth };
            }
            const content = scene.add.text((this.textHorizontalPadding ?? this.padding / 2), this.yPosition, _text, style);
            this.contentContainer.add(content);
            this.yPosition += content.height + this.padding;
        }
    }

    private commonRules(scene: GameScene, genericTableWidth: number, scaledSymbolSize: number): void {
        
        this.addContent(scene, 'How to Play', 'title');
        const commonPadding = 20;
        
        // Align How to Play container with other sections (same left offset and width)
        const howToPlayContainer = scene.add.container(-this.padding * 1.5, this.yPosition);

        const tableWidth = this.contentWidth + this.padding * 3;
        this.yPosition += this.createBorder(scene, howToPlayContainer, 
            this.padding, 
            0, 
            tableWidth, 
            scaledSymbolSize * 25
        );
        this.contentContainer.add(howToPlayContainer);

        // Align header and entries with the same left padding used in other sections
        const leftPad = this.padding * 3; // same as Paylines text left align
        this.addTextBlock(scene, 'header2', 'Bet Controls', { container: howToPlayContainer, x: leftPad, y: commonPadding / 2 });

        this.createHowToPlayEntry(scene, leftPad, commonPadding * 5 , howToPlayContainer, 'howToPlay1Mobile', '');

        this.addTextBlock(scene, 'header2', 'Game Actions', { container: howToPlayContainer, x: leftPad, y: commonPadding * 9.5 });
        
        this.createHowToPlayEntry(scene, leftPad, commonPadding * 15, howToPlayContainer, 'howToPlay2Mobile', '');
        this.createHowToPlayEntry(scene, leftPad, commonPadding * 25, howToPlayContainer, 'howToPlay11Mobile', '');
        this.createHowToPlayEntry(scene, leftPad, commonPadding * 38, howToPlayContainer, 'howToPlay12Mobile', '');
        this.createHowToPlayEntry(scene, leftPad, commonPadding * 50, howToPlayContainer, 'howToPlay3Mobile', '');
        this.createHowToPlayEntry(scene, leftPad, commonPadding * 60, howToPlayContainer, 'howToPlay4Mobile', '');

        this.addTextBlock(scene, 'header2', 'Display & Stats', { container: howToPlayContainer, x: leftPad, y: commonPadding * 66 });

        this.createHowToPlayEntry(scene, leftPad, this.isMobile ? commonPadding * 72 : commonPadding * 52, howToPlayContainer, 'howToPlay5', 'Shows your current available credits.', true, this.contentWidth - this.padding * 2);
        this.createHowToPlayEntry(scene, leftPad, this.isMobile ? commonPadding * 82 : commonPadding * 59, howToPlayContainer, 'howToPlay6', 'Display your total winnings from the current round.', true, this.contentWidth - this.padding * 2);
        this.createHowToPlayEntry(scene, leftPad, this.isMobile ? commonPadding * 93 : commonPadding * 66, howToPlayContainer, 'howToPlay7', 'Adjust your wager using the - and + buttons.', true, this.contentWidth - this.padding * 2);

        this.addTextBlock(scene, 'header2', 'General Controls', { container: howToPlayContainer, x: leftPad, y: commonPadding * 101 });

        this.createHowToPlayEntry(scene, leftPad, commonPadding * 107, howToPlayContainer, 'howToPlay8Mobile', '');  
        this.createHowToPlayEntry(scene, leftPad, commonPadding * 114.5, howToPlayContainer, 'howToPlay9Mobile', '');
        this.createHowToPlayEntry(scene, leftPad, commonPadding * 124, howToPlayContainer, 'howToPlay10Mobile', '');        

        this.yPosition -= scaledSymbolSize * 15;
    }

    private createHeader(scene: GameScene, x: number, y: number, container: GameObjects.Container, text: string, color: string): void {
        const genericTableWidth = this.contentWidth + this.padding * 3;
        
        const header = scene.add.text(0, 0,text,
            {
                ...this.textStyle,
                wordWrap: { width: genericTableWidth - this.padding * 6 },
                fontSize: '20px',
                color: color,
                fontFamily: 'Poppins-Regular',
                fontStyle: 'bold'
            }
        );
        header.setPosition(x, y);
        container.add(header);
    }

    private enableScrolling(scene: Scene): void {
        let isDragging = false;
        let startY = 0;
        let currentY = 0;
        let lastY = 0;
        let dragVelocity = 0;
        const minVelocity = 0.1;

        // Make the scroll view interactive for the content area width and height
        this.scrollView.setInteractive(new Phaser.Geom.Rectangle(
            0, 0,
            this.contentArea.width,
            this.contentArea.height
        ), Phaser.Geom.Rectangle.Contains);

        this.scrollView.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            isDragging = true;
            // pointer.worldY = logical game px (pointer.y is physical canvas px under HiResRender).
            startY = pointer.worldY;
            lastY = pointer.worldY;
            // Stop any ongoing momentum scrolling
            if (scene.tweens.isTweening(this.contentContainer)) {
                scene.tweens.killTweensOf(this.contentContainer);
            }
        });

        scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
            if (!isDragging || !this.isVisible) return;

            // Calculate the distance moved since last frame
            const deltaY = pointer.worldY - lastY;
            lastY = pointer.worldY;
            
            // Update velocity
            dragVelocity = deltaY;

            // Update position
            currentY = this.contentContainer.y + deltaY;
            
            // Calculate bounds
            const maxY = 0;
            const contentHeight = this.yPosition;
            const viewHeight = this.contentArea.height;
            const minY = Math.min(0, viewHeight - contentHeight);
            
            // Apply bounds with elastic effect
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

            // Apply momentum scrolling
            if (Math.abs(dragVelocity) > minVelocity) {
                let targetY = this.contentContainer.y + (dragVelocity * 20);
                
                // Calculate bounds
                const maxY = 0;
                const contentHeight = this.yPosition;
                const viewHeight = this.contentArea.height;
                const minY = Math.min(0, viewHeight - contentHeight);
                
                // Clamp target position
                targetY = Phaser.Math.Clamp(targetY, minY, maxY);
                
                scene.tweens.add({
                    targets: this.contentContainer,
                    y: targetY,
                    duration: 500,
                    ease: 'Cubic.out'
                });
            } else {
                // If velocity is too low, just snap to bounds
                const maxY = 0;
                const minY = Math.min(0, scene.scale.height - this.yPosition);
                const targetY = Phaser.Math.Clamp(this.contentContainer.y, minY, maxY);
                
                if (targetY !== this.contentContainer.y) {
                    scene.tweens.add({
                        targets: this.contentContainer,
                        y: targetY,
                        duration: 200,
                        ease: 'Cubic.out'
                    });
                }
            }
        });

        // Enable mouse wheel scrolling
        scene.input.on('wheel', (_pointer: any, _gameObjects: any, _deltaX: number, deltaY: number) => {
            if (!this.isVisible) return;
            
            // Calculate new position
            currentY = this.contentContainer.y - deltaY;
            
            // Calculate bounds
            const maxY = 0;
            const contentHeight = this.yPosition;
            const viewHeight = this.contentArea.height;
            const minY = Math.min(0, viewHeight - contentHeight);
            
            // Clamp the position
            currentY = Phaser.Math.Clamp(currentY, minY, maxY);
            
            // Animate to new position
            scene.tweens.add({
                targets: this.contentContainer,
                y: currentY,
                duration: 100,
                ease: 'Cubic.out'
            });
        });
    }

    
    private createHowToPlayEntry(scene: GameScene, x: number, y: number, container: GameObjects.Container, image: string, text: string, wordWrap: boolean = false, wordWrapWidth: number = 0): void {
        let imageElement: Phaser.GameObjects.Image | null = null;
        if (image !== '') {
            imageElement = scene.add.image(0, 0, image);
        }
        if (imageElement != null) {
            if (image === 'wheelSpin_helper' || image === 'scatterGame' || image === 'multiplierGame') {
                imageElement.setScale(1.1);
            }
            imageElement.setOrigin(0.5, image === 'scatterGame' ? 0.33 : 0.5);

            // Center horizontally within the container's framed area if available
            // @ts-ignore
            const frameW = (container.getData && container.getData('frameW')) || (this.contentWidth + this.padding * 3);
            // @ts-ignore
            const frameX = (container.getData && container.getData('frameX')) || this.padding;
            const centerX = frameX + frameW / 2;
            imageElement.setPosition(centerX, y);
            container.add(imageElement);
        }

        const textElement = scene.add.text(
            0, 0,
            text,
            {
                ...this.textStyle,
                wordWrap: wordWrap ? { width: wordWrapWidth } : undefined,
            }
        );
        // Place text below the image (or at y if no image), left-aligned with container padding
        const textX = this.padding * 3;
        const textY = imageElement ? (imageElement.y + (imageElement.displayHeight / 2) + this.padding * 2) : y;
        textElement.setPosition(textX, textY);
        textElement.setOrigin(0, 0);

        if (image === 'BuyFeatMobile') {
            textElement.setPosition(textX, y + this.padding * 5);
        }
        if (image === 'scatterGame') {
            textElement.setPosition(textX, textElement.y + this.padding * 6);
        }
        container.add(textElement);
        this.yPosition += (imageElement ? imageElement.displayHeight * 2 : 0) + textElement.displayHeight + this.padding * 2;
    }

    // Helper: render a help subsection with title, centered image, and description
    // Returns the bottom Y of the description to aid in subsequent spacing
    private addHelpSubSection(
        scene: GameScene,
        container: GameObjects.Container,
        title: string,
        imageKey: string,
        titleY: number,
        description: string,
        opts?: { imageY?: number; descY?: number; descX?: number; titleX?: number; titleToImageGap?: number; imageToDescGap?: number }
    ): number {
        // Title (use header2 style) with same horizontal inset as Bonus Trigger
        this.addTextBlock(scene, 'header2', title, {
            container,
            x: opts?.titleX ?? ((this.textHorizontalPadding ?? this.padding / 2) + this.padding * 1.5),
            y: titleY
        });

        // Frame metrics for centering
        // @ts-ignore
        const frameW = (container.getData && container.getData('frameW')) || (this.contentWidth + this.padding * 3);
        // @ts-ignore
        const frameX = (container.getData && container.getData('frameX')) || this.padding;
        const centerX = frameX + frameW / 2;

        // Image
        const imageY = opts?.imageY ?? (titleY + (opts?.titleToImageGap ?? this.padding * 7));
        const img = scene.add.image(centerX, imageY, imageKey);
        const useOffsetOrigin = imageKey === 'scatterGame' || imageKey === 'wheelSpin_helper';
        img.setOrigin(0.5, useOffsetOrigin ? 0.33 : 0.5);
        img.setScale(1.1);
        container.add(img);

        // Description
        const descX = opts?.descX ?? (this.padding * 3);
        const descY = opts?.descY ?? (img.y + (img.displayHeight / 2) + (opts?.imageToDescGap ?? this.padding * 3));
        const descText = scene.add.text(descX, descY, description, {
            ...this.textStyle,
            wordWrap: { width: this.contentWidth + this.padding * 3 }
        });
        descText.setOrigin(0, 0);
        container.add(descText);

        return descText.y + descText.displayHeight;
    }

    // Helper: image → title → description layout; returns bottom Y
    private addHelpSubSectionImageFirst(
        scene: GameScene,
        container: GameObjects.Container,
        title: string,
        imageKey: string,
        topY: number,
        description: string,
        opts?: { descX?: number; titleX?: number; imageToTitleGap?: number; titleToDescGap?: number }
    ): number {
        // Frame metrics
        // @ts-ignore
        const frameW = (container.getData && container.getData('frameW')) || (this.contentWidth + this.padding * 3);
        // @ts-ignore
        const frameX = (container.getData && container.getData('frameX')) || this.padding;
        const centerX = frameX + frameW / 2;

        // Image centered at topY
        const img = scene.add.image(centerX, topY, imageKey);
        const useOffsetOrigin = imageKey === 'scatterGame' || imageKey === 'wheelSpin_helper';
        img.setOrigin(0.5, useOffsetOrigin ? 0.33 : 0.5);
        img.setScale(1.1);
        container.add(img);

        // Title below image
        const titleY = img.y + (img.displayHeight / 2) + (opts?.imageToTitleGap ?? this.padding * 3);
        this.addTextBlock(scene, 'header2', title, {
            container,
            x: opts?.titleX ?? ((this.textHorizontalPadding ?? this.padding / 2) + this.padding * 1.5),
            y: titleY,
        });

        // Description below title
        const descX = opts?.descX ?? (this.padding * 3);
        const descY = titleY + (opts?.titleToDescGap ?? this.padding * 3);
        const descText = scene.add.text(descX, descY, description, {
            ...this.textStyle,
            wordWrap: { width: this.contentWidth + this.padding * 3 }
        });
        descText.setOrigin(0, 0);
        container.add(descText);

        return descText.y + descText.displayHeight;
    }

    // New helper as requested: explicit image position, relative offsets for title and description
    private addSubSectionInstruction(
        scene: GameScene,
        container: GameObjects.Container,
        params: {
            title: string;
            imageKey: string;
            imageX: number;
            imageY: number;
            imageOrigin?: { x: number; y: number };
            imageScale?: number;
            titleOffsetY: number; // distance below image
            titleX?: number;
            desc: string;
            descOffsetY: number; // distance below title
            descX?: number;
            wordWrapWidth?: number;
        }
    ): number {
        const img = scene.add.image(params.imageX, params.imageY, params.imageKey);
        img.setOrigin(params.imageOrigin?.x ?? 0.5, params.imageOrigin?.y ?? 0.5);
        if (params.imageScale) {
            img.setScale(params.imageScale);
        }
        container.add(img);

        const titleY = img.y + (img.displayHeight / 2) + params.titleOffsetY;
        this.addTextBlock(scene, 'header2', params.title, {
            container,
            x: params.titleX ?? ((this.textHorizontalPadding ?? this.padding / 2) + this.padding * 1.5),
            y: titleY
        });

        const descY = titleY + params.descOffsetY;
        const descText = scene.add.text(params.descX ?? (this.padding * 3), descY, params.desc, {
            ...this.textStyle,
            wordWrap: params.wordWrapWidth ? { width: params.wordWrapWidth } : { width: this.contentWidth + this.padding * 3 }
        });
        descText.setOrigin(0, 0);
        container.add(descText);

        return descText.y + descText.displayHeight;
    }

    private createBorder(scene: GameScene, _container: GameObjects.Container, _x: number, _y: number, _width: number, _height: number): number {
        const border = scene.add.graphics();
        border.fillStyle(0x333333);
        border.fillRoundedRect(_x, _y, _width, _height, 8);
        border.lineStyle(2, 0x333333);
        border.strokeRoundedRect(_x, _y, _width, _height, 8);
        border.setAlpha(0.7);
        _container.add(border);
        _container.sendToBack(border);
        // Store frame metrics on the container for layout helpers
        try {
            // Using Data Manager only if available on container
            // @ts-ignore
            if (_container.setData) {
                // @ts-ignore
                _container.setData('frameX', _x);
                // @ts-ignore
                _container.setData('frameY', _y);
                // @ts-ignore
                _container.setData('frameW', _width);
                // @ts-ignore
                _container.setData('frameH', _height);
            }
        } catch { /* no-op */ }
        return _height;
    }

    private addDivider(scene: GameScene, _color: number = 0xFFFFFF): void {
        // Add centered divider across the visible content width
        const divider = scene.add.graphics();
        divider.lineStyle(1, _color);
        const worldLeft = 20; // content area left padding
        const worldRight = scene.scale.width - 20; // content area right padding
        const parentOffsetX = this.contentArea ? this.contentArea.x : 0;
        const localLeft = worldLeft - parentOffsetX;
        const localRight = worldRight - parentOffsetX;
        divider.lineBetween(localLeft, this.yPosition, localRight, this.yPosition);
        this.contentContainer.add(divider);
        this.yPosition += this.padding;
    }

    private createPayoutTable(scene: GameScene, x: number, y: number, container: GameObjects.Container, symbolIndex: number): void {
        const cellWidth1 = 60; 
        const cellWidth2 = 100;
        const cellHeight = 22.5;
        const cellPadding = 5;

        const tableHeight = (cellHeight + cellPadding) * 4;
        const matchNumRange : string[] = ['5', '4', '3'];
        const scatterNumRange : string[] = ['6', '5', '4'];
        const scatterText: string[] = [
            'Appears only on reels 1, 3, and 5.', 
            'Landing 3 BONUS symbols',
            'triggers the Free Spins Round.', 
            '3x BONUS symbols award 5x your',
            'total bet.',
            'BONUS symbols pay in any',
            'position.'
        ];
        // Center the table vertically relative to the symbol
        const tableY = y - tableHeight / 2;

        // Create table background
        const graphics = scene.add.graphics();

        let payoutAdjustments : [number, number, number] = [200.00, 10.00, 6.00];
        for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 3; col++) {
                let cellWidth = 0;
                if(col == 0) {
                    cellWidth = cellWidth1;
                } else if(col == 1) {
                    cellWidth = cellWidth2;
                } else {
                    cellWidth = cellWidth2 * 2;
                }
                const cellX = x + (col == 2 ? cellWidth1 + cellWidth2 + cellPadding * 2 : col * (cellWidth + cellPadding));
                const cellY = tableY + row * (cellHeight + cellPadding);

                // Draw cell border
                graphics.strokeRect(cellX, cellY, cellWidth, cellHeight);

                if(symbolIndex != 0) {
                    // For regular symbols
                    if(col < 2) {
                        // Payout values per symbol (1-11) for rows ['12+', '10', '8']
                        const payoutMap: { [key: number]: [number, number, number] } = {
                            1: [37.50, 7.50, 2.50],
                            2: [25.00, 5.00, 1.75],
                            3: [15.00, 3.00, 1.25],
                            4: [10.00, 2.00, 1.25],
                            5: [7.50, 1.25, 0.60],
                            6: [5.00, 1.00, 0.40],
                            7: [2.50, 0.50, 0.25],
                            8: [2.50, 0.50, 0.25],
                            9: [1.25, 0.25, 0.10],
                            10: [1.25, 0.25, 0.10],
                            11: [1.25, 0.25, 0.10]
                        };
                        const payoutValue = (payoutMap[symbolIndex] && payoutMap[symbolIndex][row] !== undefined) ? payoutMap[symbolIndex][row] : 0;
                        const text2 = formatCurrencyNumber(payoutValue);
                        payoutAdjustments[row] = text2.length;

                        let text : string;  
                        const repeatTimes = payoutAdjustments[0] - text2.length;

                        const isDemoPayout = scene.gameAPI?.getDemoState();
                        const currencyPrefixPayout = isDemoPayout ? '' : CurrencyManager.getCurrencyCode();

                        if(repeatTimes > 0){
                            text = col == 0 ? matchNumRange[row] : 
                                ' '.repeat(repeatTimes) + currencyPrefixPayout + text2;
                        }
                        else{
                            text = col == 0 ? matchNumRange[row] : 
                                currencyPrefixPayout + text2;
                        }

                        let textElement : GameObjects.Text;
                        if(col == 0){
                            textElement = scene.add.text(cellX + cellWidth + 25, cellY + cellHeight/2, text, {
                                fontSize: '20px',
                                color: '#FFFFFF',
                                fontFamily: 'Poppins-Regular', 
                                align: 'left',
                                fontStyle: 'bold'
                            });
                            textElement.setOrigin(0, 0.5);
                        } else {
                            // Right-align payout values to the cell's right edge (with 2px inset)
                            textElement = scene.add.text(cellX + cellWidth + 50, cellY + cellHeight/2, text, {
                                fontSize: '20px',
                                color: '#FFFFFF',
                                fontFamily: 'Poppins-Regular', 
                                align: 'right'
                            });
                            textElement.setOrigin(1, 0.5);
                        }

                        container.add(textElement);
                    }
                } else {
                    // For scatter symbol
                    const text2 = formatCurrencyNumber(0);
                        payoutAdjustments[row] = text2.length;

                        let text : string;  
                        const repeatTimes = payoutAdjustments[0] - text2.length;

                        const isDemoPayout = scene.gameAPI?.getDemoState();
                        const currencyPrefixPayout = isDemoPayout ? '' : CurrencyManager.getCurrencyCode();

                        if(repeatTimes > 0){
                            text = col == 0 ? scatterNumRange[row] : 
                                ' '.repeat(repeatTimes) + currencyPrefixPayout + text2;
                        }
                        else{
                            text = col == 0 ? scatterNumRange[row] : 
                                currencyPrefixPayout + text2;
                        }

                    if(col == 0) {
                        const textElement = scene.add.text(cellX + cellWidth + this.padding, cellY + cellHeight/2, text, {
                            fontSize: '20px',
                            color: '#FFFFFF',
                            fontFamily: 'Poppins-Regular',
                            fontStyle: 'bold'
                        });
                        textElement.setOrigin(col == 0 ? 0 : 0.5, 0.5);
                        container.add(textElement);
                    } else if(col == 1) {
                        
                        const textElement = scene.add.text(cellX + cellWidth , cellY + cellHeight/2, text, {
                            fontSize: '20px',
                            color: '#FFFFFF',
                            fontFamily: 'Poppins-Regular'
                        });
                        textElement.setOrigin(0.5, 0.5);
                        container.add(textElement);
                    
                    } else {
                        // Do not place scatter descriptive text within the third column cells; we'll place it below the table instead
                    }
                }
            }
        }
        // For Scatter symbol, place the descriptive text as a centered block BELOW the table
        if (symbolIndex === 0) {
            const tableWidth = cellWidth1 + cellPadding + cellWidth2 + cellPadding + (cellWidth2 * 2);
            const tableLeft = x;
            const tableCenterX = tableWidth / 2;
            const tableBottomY = tableY + (3 * (cellHeight + cellPadding));

            const infoText = scatterText.join('\n');
            const scatterTextCell = scene.add.text(
                tableCenterX,
                tableBottomY + this.padding * 3,
                infoText,
                {
                    fontSize: '20px',
                    color: '#FFFFFF',
                    fontFamily: 'Poppins-Regular',
                    align: 'left',
                    wordWrap: { width: tableWidth - this.padding}
                }
            );
            scatterTextCell.setOrigin(0.5, 0);
            container.add(scatterTextCell);
        }
        container.add(graphics);
    }


    public toggleMenu(scene: GameScene): void {
        if (this.isVisible) {
            return; // close tab is the canonical exit; do not double-open
        }
        this.showMenu(scene);
    }

    // addHeader1/addHeader2/addContent1 removed in favor of addTextBlock

    private addTextBlock(
        scene: GameScene,
        kind: 'header1' | 'header2' | 'content1',
        text: string,
        opts?: {
            x?: number;
            y?: number;
            container?: GameObjects.Container;
            spacingAfter?: number;
            wordWrapWidth?: number;
        }
    ): GameObjects.Text {
        let baseStyle: any;
        switch (kind) {
            case 'header1': baseStyle = this.header1Style; break;
            case 'header2': baseStyle = this.header2Style; break;
            case 'content1': baseStyle = this.content1Style; break;
        }
        const style = { ...baseStyle } as Phaser.Types.GameObjects.Text.TextStyle;
        if (opts?.wordWrapWidth) {
            style.wordWrap = { width: opts.wordWrapWidth } as any;
        }
        const container = opts?.container ?? this.contentContainer;
        const x = opts?.x ?? (this.textHorizontalPadding ?? this.padding / 2);
        const y = opts?.y ?? this.yPosition;
        const txt = scene.add.text(x, y, text, style);
        container.add(txt);
        if (opts?.y === undefined) {
            const spacing = opts?.spacingAfter ?? this.padding;
            this.yPosition += txt.height + spacing;
        }
        return txt;
    }
}