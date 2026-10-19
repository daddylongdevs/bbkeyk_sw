/** Margin/padding value: number (all sides) or per-side object. Default 0. */
export type Spacing = number | { top?: number; right?: number; bottom?: number; left?: number };

/**
 * Option types shared across ContentSection layout elements.
 * align/anchor can be numbers (0–1) or string shorthands depending on your renderer.
 * Padding is inward spacing; margin is outward spacing (default 0).
 */
export interface LayoutOpts {
    padding?: Spacing;
    /** Outward spacing (default 0). */
    margin?: Spacing;
    align?: number | string;
    offset?: { x?: number; y?: number };
    anchor?: number | { x?: number; y?: number };
}

export interface HeaderOpts extends LayoutOpts {
    style?: Record<string, unknown>;
    /**
     * Extra space between lines in pixels (e.g. when header text wraps).
     */
    lineSpacing?: number;
    /**
     * Set to true to render text from right-to-left (RTL).
     * Defaults to false (left-to-right).
     */
    rtl?: boolean;
}

export interface BorderOpts {
    padding?: Spacing;
    /** Outward spacing (default 0). */
    margin?: Spacing;
    style?: Record<string, unknown>;
    /** Border radius (default 8). */
    borderRadius?: number;
}

export interface ImageOpts extends LayoutOpts {
    // padding, align, offset, anchor only (no style)
    /**
     * How the image size should be calculated:
     * - 'native': Uses the texture's native size (default)
     * - 'fitToWidth': Scales image to fit container width while maintaining aspect ratio
     * - 'fitToHeight': Scales image to fit maxHeight while maintaining aspect ratio (requires maxHeight)
     */
    size?: 'native' | 'fitToWidth' | 'fitToHeight';
    /**
     * Maximum height for 'fitToHeight' sizing mode.
     * Required when size is 'fitToHeight'.
     */
    maxHeight?: number;
    /**
     * Uniform scale multiplier applied after sizing. Defaults to 1.
     */
    scale?: number;
    /**
     * Whether the scale multiplier should affect layout calculations (spacing, positioning of other elements).
     * When true (default), scale affects both visual appearance and layout.
     * When false, scale only affects visual appearance; layout uses unscaled dimensions.
     */
    scaleAffectsLayout?: boolean;
}

export interface TextOpts extends LayoutOpts {
    // padding, align, offset, anchor only
    style?: Record<string, unknown>;
    /**
     * Extra space between lines in pixels (e.g. when text wraps).
     * Applied in addition to the font’s natural line height.
     */
    lineSpacing?: number;
    /**
     * Set to true to render text from right-to-left (RTL).
     * Defaults to false (left-to-right).
     */
    rtl?: boolean;
    /**
     * When true, text will scale down to fit within its container bounds (determined by
     * container dimensions, padding, and opts). Prevents overlap when values vary in length.
     */
    fitToBounds?: boolean;
    /**
     * When true, this text scales its font size down so the full string fits on a single line
     * within the available width (no word wrapping). If it still does not fit at minFontSize,
     * the text is rendered at minFontSize and may overflow/clip horizontally.
     */
    fitToSingleLine?: boolean;
    /**
     * Minimum font size in pixels used by fitToSingleLine. Defaults to 12.
     */
    minFontSize?: number;
}

export interface LineBreakOpts {
    thickness?: number;
    padding?: Spacing;
    /** Outward spacing (default 0). */
    margin?: Spacing;
}

/**
 * Inline image inside rich text. `key` is the image asset key to display.
 * Optionally includes `text` to display as an overlay on top of the image.
 * Text alignment can be 'left', 'right', or 'center' (default).
 */
export interface TextImageRun {
    TextImage: { 
        key: string; 
        opts?: ImageOpts; 
        text?: { 
            value: string; 
            style?: Record<string, unknown>; 
            align?: 'left' | 'right' | 'center';
            /** Localization key; when set, displayed text is resolved via HelpScreen.getHelpText. */
            key?: string;
        } 
    };
}

/**
 * Styled text run inside rich text. Allows applying custom styles to specific text segments.
 */
export interface TextRun {
    Text: {
        value: string;
        style?: Record<string, unknown>;
        /** Localization key; when set, displayed text is resolved via HelpScreen.getHelpText. */
        key?: string;
        /**
         * When true, this run shrinks font size down to fit on one line without wrapping.
         * Applies only to pure text runs (no inline placeholder images).
         */
        fitToSingleLine?: boolean;
        /**
         * Minimum font size in pixels used by fitToSingleLine. Defaults to 12.
         */
        minFontSize?: number;
    };
}

/** One segment of rich text: either a string, a styled TextRun, or an inline TextImage. */
export type RichTextPart = string | TextRun | TextImageRun;
export type RichTextPlaceholderImage = TextImageRun['TextImage'] | TextImageRun['TextImage'][];

/**
 * A single cell in a grid that can contain either text or an image.
 */
export type GridCell =
    | { Text: { opts?: TextOpts; value?: string; /** Localization key; when set, displayed text is resolved via HelpScreen.getHelpText. */ key?: string } }
    | { Image: { opts?: ImageOpts; key?: string; src?: string } };

/**
 * Grid spacing mode.
 * - 'fit': Fit all elements in the available space, taking into account their alignment and anchoring (default)
 * - 'fitToWidth': Spread columns to fill width; uses horizontalSpacing as gap between columns
 * - 'fitToHeight': Stack rows with gap; uses verticalSpacing as gap between rows
 */
export type GridSpacing = 'fit' | 'fitToWidth' | 'fitToHeight';

/**
 * Grid alignment mode.
 * - 'left': All elements are left aligned
 * - 'right': All elements are right aligned
 * - 'center': Grid is centered in the container; cells are center aligned/anchored
 * - 'justified': Leftmost column is left aligned/anchored, rightmost column is right aligned/anchored, middle columns are center aligned/anchored
 */
export type GridAlignment = 'left' | 'right' | 'center' | 'justified';

export interface GridOpts extends LayoutOpts {
    /**
     * Number of columns in the grid.
     */
    columns: number;
    /**
     * Number of rows in the grid.
     */
    rows: number;
    /**
     * Spacing mode for the grid.
     * Defaults to 'fit'.
     */
    spacing?: GridSpacing;
    /**
     * Alignment mode for the grid.
     * Defaults to 'left'.
     */
    alignment?: GridAlignment;
    /**
     * Gap between grid cells (horizontal and vertical).
     * Defaults to 0.
     */
    gap?: number | { x?: number; y?: number };
    /**
     * Override gap between columns. When set, used instead of gap.x (e.g. for fitToWidth).
     */
    horizontalSpacing?: number;
    /**
     * Override gap between rows. When set, used instead of gap.y (e.g. for fitToHeight).
     */
    verticalSpacing?: number;
    /**
     * Optional per-column width percentages.
     * When fewer values are provided than `columns`, remaining columns share
     * the leftover percentage equally.
     * Examples:
     * - 2 columns, [30] -> [30, 70]
     * - 3 columns, [30] -> [30, 35, 35]
     * Values are normalized so final widths always fit the grid width.
     */
    columnWidthPercents?: number[];
}

/**
 * Row spacing mode.
 * - 'fit': Fit all elements in the available space, taking into account their alignment and anchoring (default)
 * - 'spread': Distribute elements evenly across the width
 */
export type RowSpacing = 'fit' | 'spread';

export interface RowOpts extends LayoutOpts {
    /**
     * Spacing mode for the row.
     * Defaults to 'fit'.
     */
    spacing?: RowSpacing;
    /**
     * Gap between row items. Used in all spacing modes as the gap between items.
     * Defaults to 0.
     */
    gap?: number;
}

/**
 * Single content block: exactly one of Header, Image, Text, RichText, LineBreak, Grid, Row, or ChildSection.
 * Content is an array of these items.
 */
export type ContentItem =
    | { Header: { opts?: HeaderOpts; value?: string; /** Localization key; when set, displayed text is resolved via HelpScreen.getHelpText. */ key?: string } }
    | { Image: { opts?: ImageOpts; key?: string; src?: string } }
    | { Text: { opts?: TextOpts; value?: string; /** Localization key; when set, displayed text is resolved via HelpScreen.getHelpText. */ key?: string } }
    | { RichText: { opts?: TextOpts; parts: RichTextPart[]; /** Optional image options for `{image_key}` placeholders inside rich text strings/Text values. */ placeholderImageOpts?: Record<string, ImageOpts>; /** Placeholder image definitions for tokens like `{image}` inside rich text strings/Text values. */ placeholderImages?: Record<string, RichTextPlaceholderImage> } }
    | { LineBreak: { opts?: LineBreakOpts } }
    | { Grid: { opts?: GridOpts; cells: GridCell[] } }
    | { Row: { opts?: RowOpts; items: ContentItem[] } }
    | { ChildSection: ContentSection };

/** Top-level section: optional header, border, and list of content items */
export interface ContentSection {
    Header?: { opts?: HeaderOpts; value?: string; /** Localization key; when set, displayed text is resolved via HelpScreen.getHelpText. */ key?: string };
    Border?: { opts?: BorderOpts };
    Content?: ContentItem[];
    /** Outward spacing for the section (default 0). */
    margin?: Spacing;
}
