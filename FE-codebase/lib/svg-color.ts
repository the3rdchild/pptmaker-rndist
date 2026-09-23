// Recolours SVG markup in place (icon fill/stroke/opacity/line caps) with
// every value sanitised before it reaches an attribute.

export interface SvgPaintOptions {
    color?: string | null;
    stroke?: string | null;
    fill?: string | null;
    strokeWidth?: string | null;
    opacity?: string | null;
    strokeOpacity?: string | null;
    fillOpacity?: string | null;
    strokeLinecap?: string | null;
    strokeLinejoin?: string | null;
}

const UNSAFE_SVG_VALUE_CHARS = /["'<>`{};\r\n]/;
const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const BARE_HEX_COLOR_PATTERN = /^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const CSS_COLOR_FUNCTION_PATTERN =
    /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|var|calc)\(.+\)$/i;
const SVG_KEYWORD_PATTERN = /^[a-z-]+$/i;
const SVG_NUMBERISH_PATTERN =
    /^-?(?:\d+\.?\d*|\d*\.?\d+)(?:%|px|em|rem|pt|pc|cm|mm|in)?$/i;
const PRESERVED_PAINT_VALUES = new Set([
    "none",
    "currentcolor",
    "context-fill",
    "context-stroke",
    "inherit",
    "transparent",
]);
const VALID_STROKE_LINECAP_VALUES = new Set([
    "butt",
    "round",
    "square",
    "inherit",
]);
const VALID_STROKE_LINEJOIN_VALUES = new Set([
    "miter",
    "miter-clip",
    "round",
    "bevel",
    "arcs",
    "inherit",
]);

const ROOT_SVG_TAG_PATTERN = /<svg\b([^>]*)>/i;

const escapeRegExp = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const shouldPreservePaintValue = (value: string): boolean => {
    const normalized = value.trim().toLowerCase();
    return (
        PRESERVED_PAINT_VALUES.has(normalized) || normalized.startsWith("url(")
    );
};

const shouldPreservePaintValueForExplicitColor = (value: string): boolean => {
    const normalized = value.trim().toLowerCase();
    return normalized !== "currentcolor" && shouldPreservePaintValue(value);
};

const replaceAttributeValue = (
    input: string,
    attrName: string,
    nextValue: string,
    preserveValue?: (currentValue: string) => boolean
): string => {
    const escapedAttrName = escapeRegExp(attrName);
    const patterns = [
        new RegExp(`(\\s${escapedAttrName}\\s*=\\s*")(.*?)(")`, "gi"),
        new RegExp(`(\\s${escapedAttrName}\\s*=\\s*')(.*?)(')`, "gi"),
        new RegExp(
            `(\\s${escapedAttrName}\\s*=\\s*)([^\\s"'=<>` + "`" + `]+)`,
            "gi"
        ),
    ];

    return patterns.reduce((output, pattern) => {
        return output.replace(
            pattern,
            (match, prefix: string, currentValue: string, suffix?: string) => {
                if (preserveValue?.(currentValue)) {
                    return match;
                }

                return suffix
                    ? `${prefix}${nextValue}${suffix}`
                    : `${prefix}${nextValue}`;
            }
        );
    }, input);
};

const replaceStyleValue = (
    input: string,
    attrName: string,
    nextValue: string,
    preserveValue?: (currentValue: string) => boolean
): string => {
    const escapedAttrName = escapeRegExp(attrName);
    const pattern = new RegExp(
        `(${escapedAttrName}\\s*:\\s*)([^;"'}]+?)(\\s*)(?=;|}|["']|$)`,
        "gi"
    );

    return input.replace(
        pattern,
        (
            match,
            prefix: string,
            currentValue: string,
            trailingWhitespace: string
        ) => {
            if (preserveValue?.(currentValue)) {
                return match;
            }

            return `${prefix}${nextValue}${trailingWhitespace}`;
        }
    );
};

const replaceSvgValue = (
    input: string,
    attrName: string,
    nextValue: string,
    preserveValue?: (currentValue: string) => boolean
): string => {
    let output = replaceAttributeValue(input, attrName, nextValue, preserveValue);
    output = replaceStyleValue(output, attrName, nextValue, preserveValue);
    return output;
};

const getRootAttributeValue = (
    input: string,
    attrName: string
): string | null => {
    const rootMatch = input.match(ROOT_SVG_TAG_PATTERN);
    if (!rootMatch) return null;
    const attrs = rootMatch[1];
    const escapedAttrName = escapeRegExp(attrName);
    const patterns = [
        new RegExp(`\\s${escapedAttrName}\\s*=\\s*"(.*?)"`, "i"),
        new RegExp(`\\s${escapedAttrName}\\s*=\\s*'(.*?)'`, "i"),
        new RegExp(`\\s${escapedAttrName}\\s*=\\s*([^\\s"'=<>` + "`" + `]+)`, "i"),
    ];
    for (const pattern of patterns) {
        const match = attrs.match(pattern);
        if (match) return match[1];
    }
    return null;
};

const upsertRootAttribute = (
    input: string,
    attrName: string,
    nextValue: string
): string => {
    return input.replace(ROOT_SVG_TAG_PATTERN, (match, attrs: string) => {
        let updatedAttrs = attrs;
        const escapedAttrName = escapeRegExp(attrName);
        const patterns = [
            new RegExp(`(\\s${escapedAttrName}\\s*=\\s*")(.*?)(")`, "i"),
            new RegExp(`(\\s${escapedAttrName}\\s*=\\s*')(.*?)(')`, "i"),
            new RegExp(
                `(\\s${escapedAttrName}\\s*=\\s*)([^\\s"'=<>` + "`" + `]+)`,
                "i"
            ),
        ];

        for (const pattern of patterns) {
            if (pattern.test(updatedAttrs)) {
                updatedAttrs = updatedAttrs.replace(
                    pattern,
                    (
                        innerMatch,
                        prefix: string,
                        _currentValue: string,
                        suffix?: string
                    ) => {
                        return suffix
                            ? `${prefix}${nextValue}${suffix}`
                            : `${prefix}${nextValue}`;
                    }
                );

                return `<svg${updatedAttrs}>`;
            }
        }

        return `<svg${updatedAttrs} ${attrName}="${nextValue}">`;
    });
};

export const normalizeSvgColor = (value?: string | null): string | null => {
    if (typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed || UNSAFE_SVG_VALUE_CHARS.test(trimmed)) {
        return null;
    }

    if (HEX_COLOR_PATTERN.test(trimmed)) {
        return trimmed;
    }

    if (BARE_HEX_COLOR_PATTERN.test(trimmed)) {
        return `#${trimmed}`;
    }

    if (CSS_COLOR_FUNCTION_PATTERN.test(trimmed)) {
        return trimmed;
    }

    if (SVG_KEYWORD_PATTERN.test(trimmed)) {
        return trimmed;
    }

    return null;
};

export const normalizeSvgNumberish = (value?: string | null): string | null => {
    if (typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed || UNSAFE_SVG_VALUE_CHARS.test(trimmed)) {
        return null;
    }

    return SVG_NUMBERISH_PATTERN.test(trimmed) ? trimmed : null;
};

export const normalizeStrokeLinecap = (
    value?: string | null
): string | null => {
    if (typeof value !== "string") {
        return null;
    }

    const normalized = value.trim().toLowerCase();
    return VALID_STROKE_LINECAP_VALUES.has(normalized) ? normalized : null;
};

export const normalizeStrokeLinejoin = (
    value?: string | null
): string | null => {
    if (typeof value !== "string") {
        return null;
    }

    const normalized = value.trim().toLowerCase();
    return VALID_STROKE_LINEJOIN_VALUES.has(normalized) ? normalized : null;
};

export const transformSvgMarkup = (
    svgContent: string,
    options: SvgPaintOptions
): string => {
    let output = svgContent;

    const normalizedColor = normalizeSvgColor(options.color);
    const normalizedStroke = normalizeSvgColor(options.stroke);
    const normalizedFill = normalizeSvgColor(options.fill);
    const normalizedStrokeWidth = normalizeSvgNumberish(options.strokeWidth);
    const normalizedOpacity = normalizeSvgNumberish(options.opacity);
    const normalizedStrokeOpacity = normalizeSvgNumberish(options.strokeOpacity);
    const normalizedFillOpacity = normalizeSvgNumberish(options.fillOpacity);
    const normalizedStrokeLinecap = normalizeStrokeLinecap(options.strokeLinecap);
    const normalizedStrokeLinejoin = normalizeStrokeLinejoin(
        options.strokeLinejoin
    );
    const rootCurrentColor =
        normalizedColor ?? normalizedFill ?? normalizedStroke;

    if (rootCurrentColor) {
        output = replaceSvgValue(output, "color", rootCurrentColor);
        output = upsertRootAttribute(output, "color", rootCurrentColor);
    }

    if (normalizedColor) {
        // An outline-style icon (fill="none" on the root, color carried by
        // stroke) must keep that "none" — forcing a root fill here would
        // make every child path render filled *and* stroked once they
        // inherit it, turning a clean outline icon into a solid blob.
        const rootFillBeforeColor = getRootAttributeValue(output, "fill");
        const preserveRootFill =
            rootFillBeforeColor != null &&
            shouldPreservePaintValueForExplicitColor(rootFillBeforeColor);

        output = replaceSvgValue(
            output,
            "stroke",
            normalizedColor,
            shouldPreservePaintValueForExplicitColor
        );
        output = replaceSvgValue(
            output,
            "fill",
            normalizedColor,
            shouldPreservePaintValueForExplicitColor
        );
        if (!preserveRootFill) {
            output = upsertRootAttribute(output, "fill", normalizedColor);
        }
    }

    if (normalizedStroke) {
        output = replaceSvgValue(
            output,
            "stroke",
            normalizedStroke,
            shouldPreservePaintValueForExplicitColor
        );
    }

    if (normalizedFill) {
        const rootFillBeforeFill = getRootAttributeValue(output, "fill");
        const preserveRootFill =
            rootFillBeforeFill != null &&
            shouldPreservePaintValueForExplicitColor(rootFillBeforeFill);

        output = replaceSvgValue(
            output,
            "fill",
            normalizedFill,
            shouldPreservePaintValueForExplicitColor
        );
        if (!preserveRootFill) {
            output = upsertRootAttribute(output, "fill", normalizedFill);
        }
    }

    if (normalizedStrokeWidth) {
        output = replaceSvgValue(output, "stroke-width", normalizedStrokeWidth);
    }

    if (normalizedOpacity) {
        output = replaceSvgValue(output, "opacity", normalizedOpacity);
        output = upsertRootAttribute(output, "opacity", normalizedOpacity);
    }

    if (normalizedStrokeOpacity) {
        output = replaceSvgValue(output, "stroke-opacity", normalizedStrokeOpacity);
    }

    if (normalizedFillOpacity) {
        output = replaceSvgValue(output, "fill-opacity", normalizedFillOpacity);
        output = upsertRootAttribute(output, "fill-opacity", normalizedFillOpacity);
    }

    if (normalizedStrokeLinecap) {
        output = replaceSvgValue(output, "stroke-linecap", normalizedStrokeLinecap);
    }

    if (normalizedStrokeLinejoin) {
        output = replaceSvgValue(
            output,
            "stroke-linejoin",
            normalizedStrokeLinejoin
        );
    }

    return output;
};