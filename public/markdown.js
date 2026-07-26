/**
 * Mechvibes-cbc Website - minimal Markdown renderer
 *
 * GitHub release notes are Markdown, but the body of a release is written by
 * anyone who can publish one: it is untrusted input. Rather than sanitising a
 * parsed HTML string, this renderer never produces HTML text at all. Every
 * node is built with `document.createElement`, and every piece of author
 * content lands in a text node. There is no code path that hands a string to
 * an HTML parser, so injection is structurally impossible rather than
 * filtered - `<script>`, `onerror=`, and friends can only ever come out as
 * visible characters.
 *
 * The grammar covers what release notes actually use - headings, emphasis,
 * inline and fenced code, lists, links, autolinked URLs, paragraphs and line
 * breaks - and deliberately nothing else.
 */
/** Protocols a link is allowed to use. Blocks `javascript:` and `data:`. */
const SAFE_PROTOCOLS = new Set(['http:', 'https:']);
/**
 * Release headings start at `#`, but they are nested inside the release
 * card's own `<h3>`. Demoting by three keeps the document outline honest;
 * the original level survives as a class so CSS can still size them.
 */
const HEADING_OFFSET = 3;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)\s*$/;
const HEADING_RE = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const UL_ITEM_RE = /^ {0,3}[-*]\s+(.*)$/;
const OL_ITEM_RE = /^ {0,3}(\d{1,9})[.)]\s+(.*)$/;
const BLANK_RE = /^\s*$/;
/**
 * Trim a release body to roughly `limit` characters, cutting on a line
 * boundary so a heading or list item is never sliced in half. A single
 * oversized line falls back to the nearest word boundary.
 */
export function truncateMarkdown(source, limit) {
    const text = source.trim();
    if (text.length <= limit)
        return { text, truncated: false };
    const lines = text.split('\n');
    const kept = [];
    let used = 0;
    for (const line of lines) {
        // +1 for the newline that rejoins this line to the previous one.
        const cost = line.length + (kept.length ? 1 : 0);
        if (used + cost > limit)
            break;
        kept.push(line);
        used += cost;
    }
    if (!kept.length) {
        // One very long first line: cut at the last space that fits.
        const slice = text.slice(0, limit);
        const space = slice.lastIndexOf(' ');
        return { text: (space > 0 ? slice.slice(0, space) : slice).trimEnd(), truncated: true };
    }
    return { text: kept.join('\n').trimEnd(), truncated: true };
}
/* ===== BLOCK LEVEL ===== */
/** Build a detached fragment of DOM nodes for `source`. */
export function renderMarkdown(source) {
    const fragment = document.createDocumentFragment();
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    let i = 0;
    while (i < lines.length) {
        const line = lines[i] ?? '';
        if (BLANK_RE.test(line)) {
            i += 1;
            continue;
        }
        const fence = FENCE_RE.exec(line);
        if (fence) {
            i = appendCodeBlock(fragment, lines, i, fence[1] ?? '```', fence[2] ?? '');
            continue;
        }
        const heading = HEADING_RE.exec(line);
        if (heading) {
            appendHeading(fragment, (heading[1] ?? '#').length, heading[2] ?? '');
            i += 1;
            continue;
        }
        if (UL_ITEM_RE.test(line) || OL_ITEM_RE.test(line)) {
            i = appendList(fragment, lines, i);
            continue;
        }
        i = appendParagraph(fragment, lines, i);
    }
    return fragment;
}
function appendCodeBlock(parent, lines, start, fence, language) {
    const marker = fence[0] ?? '`';
    const closing = new RegExp(`^ {0,3}\\${marker}{${fence.length},}\\s*$`);
    const body = [];
    let i = start + 1;
    for (; i < lines.length; i += 1) {
        const line = lines[i] ?? '';
        if (closing.test(line)) {
            i += 1;
            break;
        }
        body.push(line);
    }
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    if (language) {
        // Attribute value, never markup - and only word characters survive.
        code.className = `language-${language.replace(/[^\w.+-]/g, '')}`;
    }
    code.textContent = body.join('\n');
    pre.appendChild(code);
    parent.appendChild(pre);
    return i;
}
function appendHeading(parent, level, text) {
    const tag = `h${Math.min(level + HEADING_OFFSET, 6)}`;
    const heading = document.createElement(tag);
    heading.className = `md-h${level}`;
    renderInline(text, heading);
    parent.appendChild(heading);
}
function appendList(parent, lines, start) {
    const first = lines[start] ?? '';
    const ordered = OL_ITEM_RE.test(first);
    const list = document.createElement(ordered ? 'ol' : 'ul');
    if (ordered) {
        const startAt = Number(OL_ITEM_RE.exec(first)?.[1] ?? '1');
        if (startAt !== 1)
            list.start = startAt;
    }
    const items = [];
    let i = start;
    for (; i < lines.length; i += 1) {
        const line = lines[i] ?? '';
        if (BLANK_RE.test(line))
            break;
        const ol = OL_ITEM_RE.exec(line);
        const ul = UL_ITEM_RE.exec(line);
        if (ordered && ol) {
            items.push(ol[2] ?? '');
        }
        else if (!ordered && ul && !ol) {
            items.push(ul[1] ?? '');
        }
        else if (items.length && /^\s+\S/.test(line)) {
            // Wrapped continuation of the previous bullet.
            items[items.length - 1] = `${items[items.length - 1]} ${line.trim()}`;
        }
        else {
            break;
        }
    }
    for (const item of items) {
        const li = document.createElement('li');
        renderInline(item, li);
        list.appendChild(li);
    }
    parent.appendChild(list);
    return i;
}
function appendParagraph(parent, lines, start) {
    const block = [];
    let i = start;
    for (; i < lines.length; i += 1) {
        const line = lines[i] ?? '';
        if (BLANK_RE.test(line) ||
            FENCE_RE.test(line) ||
            HEADING_RE.test(line) ||
            UL_ITEM_RE.test(line) ||
            OL_ITEM_RE.test(line)) {
            break;
        }
        block.push(line.trim());
    }
    if (block.length) {
        const paragraph = document.createElement('p');
        renderInline(block.join('\n'), paragraph);
        parent.appendChild(paragraph);
    }
    return i === start ? start + 1 : i;
}
/* ===== INLINE LEVEL ===== */
const CODE_RE = /^(`+)([\s\S]*?)\1(?!`)/;
const LINK_RE = /^\[([^\]\n]*)\]\(\s*([^\s()]*)(?:\s+"[^"\n]*")?\s*\)/;
const AUTOLINK_RE = /^https?:\/\/[^\s<>"'`]+/;
const STRONG_RE = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/;
const EM_RE = /^([*_])(?=[^\s*_])([\s\S]*?[^\s*_])\1(?!\1)/;
/**
 * Walk `text`, appending text nodes and inline elements to `parent`. Anything
 * that is not recognised syntax is emitted verbatim as a text node, which is
 * why stray HTML shows up as characters instead of being interpreted.
 *
 * `inLink` is set while rendering a link's own label. Anchors cannot nest, and
 * without it `[https://a](https://b)` would recurse forever building one link
 * inside the next.
 */
function renderInline(text, parent, inLink = false) {
    let buffer = '';
    let i = 0;
    const flush = () => {
        if (buffer) {
            parent.appendChild(document.createTextNode(buffer));
            buffer = '';
        }
    };
    while (i < text.length) {
        const char = text[i] ?? '';
        if (char === '\n') {
            flush();
            parent.appendChild(document.createElement('br'));
            i += 1;
            continue;
        }
        // Only these characters can begin a construct, so skip the regex work
        // for the overwhelmingly common case of ordinary prose.
        if (char !== '`' && char !== '[' && char !== '*' && char !== '_' && char !== 'h') {
            buffer += char;
            i += 1;
            continue;
        }
        const rest = text.slice(i);
        const code = char === '`' ? CODE_RE.exec(rest) : null;
        if (code) {
            flush();
            const element = document.createElement('code');
            element.textContent = (code[2] ?? '').trim();
            parent.appendChild(element);
            i += code[0].length;
            continue;
        }
        const link = char === '[' && !inLink ? LINK_RE.exec(rest) : null;
        if (link) {
            flush();
            appendLink(parent, link[1] ?? '', link[2] ?? '', link[0]);
            i += link[0].length;
            continue;
        }
        const auto = char === 'h' && !inLink ? AUTOLINK_RE.exec(rest) : null;
        if (auto) {
            const url = trimUrlTail(auto[0]);
            const anchor = safeAnchor(url, url);
            if (anchor) {
                flush();
                parent.appendChild(anchor);
                i += url.length;
                continue;
            }
        }
        const strong = char === '*' || char === '_' ? STRONG_RE.exec(rest) : null;
        if (strong) {
            flush();
            const element = document.createElement('strong');
            renderInline(strong[2] ?? '', element, inLink);
            parent.appendChild(element);
            i += strong[0].length;
            continue;
        }
        // `snake_case_words` are not emphasis on GitHub, so an underscore only
        // opens emphasis when it does not sit between word characters.
        const emAllowed = char === '*' || !/\w/.test(text[i - 1] ?? '');
        const em = emAllowed && (char === '*' || char === '_') ? EM_RE.exec(rest) : null;
        if (em) {
            flush();
            const element = document.createElement('em');
            renderInline(em[2] ?? '', element, inLink);
            parent.appendChild(element);
            i += em[0].length;
            continue;
        }
        buffer += char;
        i += 1;
    }
    flush();
}
/**
 * Render `[label](href)`. An unusable or unsafe href is not "cleaned up" and
 * linked anyway - the whole construct is shown as literal text, so a reader
 * can see exactly what the release author wrote.
 */
function appendLink(parent, label, href, raw) {
    const anchor = safeAnchor(href, label || href);
    if (!anchor) {
        parent.appendChild(document.createTextNode(raw));
        return;
    }
    parent.appendChild(anchor);
}
/**
 * Build an anchor, or return null when the URL is not an absolute http(s)
 * one. `new URL()` does the parsing, so protocol detection cannot be fooled
 * by casing, whitespace or entity tricks the way a string test can.
 */
function safeAnchor(href, label) {
    let parsed;
    try {
        parsed = new URL(href);
    }
    catch {
        return null;
    }
    if (!SAFE_PROTOCOLS.has(parsed.protocol))
        return null;
    const anchor = document.createElement('a');
    anchor.href = parsed.href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    renderInline(label, anchor, true);
    return anchor;
}
/** Drop sentence punctuation that trailed a bare URL rather than belonging to it. */
function trimUrlTail(url) {
    let end = url.length;
    while (end > 0) {
        const char = url[end - 1] ?? '';
        if ('.,;:!?'.includes(char)) {
            end -= 1;
            continue;
        }
        if (char === ')') {
            const slice = url.slice(0, end);
            const opens = (slice.match(/\(/g) ?? []).length;
            const closes = (slice.match(/\)/g) ?? []).length;
            if (closes > opens) {
                end -= 1;
                continue;
            }
        }
        break;
    }
    return url.slice(0, end);
}
