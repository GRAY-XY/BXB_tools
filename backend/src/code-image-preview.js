import { randomUUID } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";

const PAGE_LINES = 46;
const MAX_CODE_CHARS = 120000;
const MAX_CODE_LINES = PAGE_LINES * 8;
const MIN_WIDTH = 240;
const MAX_WIDTH = 2000;
const LINE_HEIGHT = 20;
const VERTICAL_PADDING = 8;
const LEFT_PADDING = 10;
const GUTTER_PADDING = 20;
const CODE_GAP = 16;
const RIGHT_PADDING = 14;

const DARK_THEME = {
  editor: "#1e1e1e",
  text: "#cccccc",
  lineNumber: "#858585",
  keyword: "#569cd6",
  string: "#ce9178",
  comment: "#6a9955",
  number: "#b5cea8",
  type: "#4ec9b0",
  function: "#dcdcaa",
  constant: "#4fc1ff",
  operator: "#d4d4d4",
  preprocessor: "#c586c0",
};

const LIGHT_THEME = {
  ...DARK_THEME,
  editor: "#ffffff",
  text: "#333333",
  lineNumber: "#237893",
  keyword: "#0000ff",
  string: "#a31515",
  comment: "#008000",
  number: "#098658",
  type: "#267f99",
  function: "#795e26",
  constant: "#0070c1",
  operator: "#333333",
  preprocessor: "#af00db",
};

const LANGUAGE_ALIASES = new Map([
  ["py", "python"], ["python3", "python"],
  ["js", "javascript"], ["jsx", "javascript"], ["mjs", "javascript"], ["cjs", "javascript"],
  ["ts", "typescript"], ["tsx", "typescript"],
  ["cs", "csharp"], ["c#", "csharp"], ["csharp", "csharp"],
  ["c", "c"], ["h", "c"], ["cc", "cpp"], ["cpp", "cpp"], ["cxx", "cpp"], ["hpp", "cpp"],
  ["java", "java"], ["go", "go"], ["rs", "rust"], ["rust", "rust"],
  ["html", "html"], ["htm", "html"], ["xml", "html"], ["css", "css"],
  ["json", "json"], ["sh", "shell"], ["bash", "shell"], ["ps1", "powershell"],
  ["sql", "sql"], ["yaml", "yaml"], ["yml", "yaml"],
]);

const KEYWORDS = {
  python: new Set("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield self".split(" ")),
  javascript: new Set("as async await break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield true false null undefined".split(" ")),
  typescript: new Set("abstract any as asserts async await break case catch class const constructor continue debugger declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface is keyof let module namespace never new null number object of package private protected public readonly require global return set static string super switch symbol this throw true try type typeof undefined unique unknown var void while with yield".split(" ")),
  csharp: new Set("abstract as async await base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while var".split(" ")),
  c: new Set("auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while _Bool _Complex".split(" ")),
  cpp: new Set("alignas alignof and asm auto bool break case catch char class const constexpr continue decltype default delete do double else enum explicit export extern false float for friend goto if inline int long namespace new noexcept not nullptr operator or private protected public register return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while".split(" ")),
  java: new Set("abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new null package private protected public return short static strictfp super switch synchronized this throw throws transient true try void volatile while".split(" ")),
  go: new Set("break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false nil".split(" ")),
  rust: new Set("as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while".split(" ")),
  shell: new Set("case coproc do done elif else esac fi for function if in select then time until while".split(" ")),
  powershell: new Set("begin break catch class continue data define do dynamicparam else elseif end enum exit filter finally for foreach from function if in param process return switch throw trap try until using var while".split(" ")),
  sql: new Set("add all alter and as asc begin between by case cast check column constraint create cross current_date current_time database default delete desc distinct drop else end exists false fetch for foreign from full group having in index inner insert into is join key left like limit not null offset on or order outer primary references right select set table then true union unique update values view when where with".split(" ")),
  yaml: new Set("false no null true yes".split(" ")),
};

const HASH_COMMENT_LANGUAGES = new Set(["python", "shell", "powershell", "yaml"]);
const DASH_COMMENT_LANGUAGES = new Set(["sql"]);
const LINE_NUMBER_FONT = '12px "Cascadia Code", Consolas, "Courier New", monospace';
const CODE_FONT = '14px "Cascadia Code", Consolas, "Courier New", monospace';

function normalizeFileName(value) {
  const source = String(value || "program.txt").trim().split(/[\\/]/).pop() || "program.txt";
  const safe = source.replace(/[<>:"|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "").slice(0, 120);
  if (!safe || safe === "." || safe === "..") throw new Error("file_name must be a valid source filename.");
  return safe;
}

function normalizeLanguage(value, fileName) {
  const supplied = String(value || "").trim().toLowerCase();
  const extension = path.extname(fileName).slice(1).toLowerCase();
  return LANGUAGE_ALIASES.get(supplied) || LANGUAGE_ALIASES.get(extension) || "text";
}

function makeTokens(line, language, state, colors) {
  const tokens = [];
  const keywords = KEYWORDS[language] || new Set();
  const hashComments = HASH_COMMENT_LANGUAGES.has(language);
  const dashComments = DASH_COMMENT_LANGUAGES.has(language);
  let index = 0;

  const add = (text, color) => {
    if (text) tokens.push({ text, color });
  };

  while (index < line.length) {
    if (state.blockComment) {
      const end = line.indexOf("*/", index);
      if (end < 0) {
        add(line.slice(index), colors.comment);
        break;
      }
      add(line.slice(index, end + 2), colors.comment);
      index = end + 2;
      state.blockComment = false;
      continue;
    }

    if (state.tripleString) {
      const end = line.indexOf(state.tripleString, index);
      if (end < 0) {
        add(line.slice(index), colors.string);
        break;
      }
      const stringEnd = end + state.tripleString.length;
      add(line.slice(index, stringEnd), colors.string);
      index = stringEnd;
      state.tripleString = "";
      continue;
    }

    if (line.startsWith("/*", index)) {
      const end = line.indexOf("*/", index + 2);
      if (end < 0) {
        add(line.slice(index), colors.comment);
        state.blockComment = true;
        break;
      }
      add(line.slice(index, end + 2), colors.comment);
      index = end + 2;
      continue;
    }

    if (line.startsWith("//", index) || (hashComments && line[index] === "#") || (dashComments && line.startsWith("--", index))) {
      add(line.slice(index), colors.comment);
      break;
    }

    if ((language === "c" || language === "cpp" || language === "csharp") && line[index] === "#") {
      const directive = line.slice(index).match(/^#[A-Za-z_]\w*/)?.[0];
      if (directive) {
        add(directive, colors.preprocessor);
        index += directive.length;
        continue;
      }
    }

    const tripleQuote = line.slice(index, index + 3);
    if (tripleQuote === "\"\"\"" || tripleQuote === "'''" ) {
      const end = line.indexOf(tripleQuote, index + 3);
      if (end < 0) {
        add(line.slice(index), colors.string);
        state.tripleString = tripleQuote;
        break;
      }
      const stringEnd = end + 3;
      add(line.slice(index, stringEnd), colors.string);
      index = stringEnd;
      continue;
    }

    const char = line[index];
    if (char === "\"" || char === "'" || (char === "`" && ["javascript", "typescript"].includes(language))) {
      const quote = char;
      let end = index + 1;
      while (end < line.length) {
        if (line[end] === "\\") {
          end += 2;
          continue;
        }
        if (line[end] === quote) {
          end += 1;
          break;
        }
        end += 1;
      }
      add(line.slice(index, end), colors.string);
      index = end;
      continue;
    }

    const identifier = line.slice(index).match(/^[A-Za-z_$][\w$]*/)?.[0];
    if (identifier) {
      const rest = line.slice(index + identifier.length);
      const nextNonSpace = rest.match(/^\s*(.)/)?.[1];
      let color = colors.text;
      if (keywords.has(identifier)) color = colors.keyword;
      else if (/^(?:true|false|null|undefined|None|True|False|nil|NaN|Infinity)$/.test(identifier)) color = colors.constant;
      else if (/^[A-Z]/.test(identifier)) color = colors.type;
      else if (nextNonSpace === "(") color = colors.function;
      add(identifier, color);
      index += identifier.length;
      continue;
    }

    const number = line.slice(index).match(/^(?:0[xX][\da-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)/)?.[0];
    if (number) {
      add(number, colors.number);
      index += number.length;
      continue;
    }

    const operator = line.slice(index).match(/^(?:===|!==|=>|==|!=|<=|>=|\+=|-=|\*=|\/=|&&|\|\||\?\?|::|->|\.\.\.|\+\+|--|\*\*|<<|>>|[=+\-*\/%!<>|&^~?:])/ )?.[0];
    if (operator) {
      add(operator, colors.operator);
      index += operator.length;
      continue;
    }

    add(char, colors.text);
    index += 1;
  }

  return tokens;
}

function drawCodePreviewPage({ codeLines, startLine, language, theme }) {
  const colors = theme === "light" ? LIGHT_THEME : DARK_THEME;
  const pageLineCount = codeLines.length;
  const measureContext = createCanvas(1, 1).getContext("2d");
  measureContext.font = CODE_FONT;
  const widestCodeLine = codeLines.reduce((width, line) => Math.max(width, measureContext.measureText(line).width), 0);
  measureContext.font = LINE_NUMBER_FONT;
  const lineNumberWidth = measureContext.measureText(String(startLine + pageLineCount - 1)).width;
  const gutterWidth = Math.ceil(lineNumberWidth + GUTTER_PADDING);
  const width = Math.max(
    MIN_WIDTH,
    Math.min(MAX_WIDTH, Math.ceil(LEFT_PADDING + gutterWidth + CODE_GAP + widestCodeLine + RIGHT_PADDING)),
  );
  const height = VERTICAL_PADDING * 2 + pageLineCount * LINE_HEIGHT;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.textBaseline = "middle";
  context.fillStyle = colors.editor;
  context.fillRect(0, 0, width, height);
  context.font = CODE_FONT;
  const codeStartX = LEFT_PADDING + gutterWidth + CODE_GAP;
  const gutterRight = LEFT_PADDING + gutterWidth - 6;
  const lineState = { blockComment: false, tripleString: "" };
  for (let index = 0; index < codeLines.length; index += 1) {
    const lineTop = VERTICAL_PADDING + index * LINE_HEIGHT;
    const baseline = lineTop + LINE_HEIGHT / 2;
    context.textAlign = "right";
    context.fillStyle = colors.lineNumber;
    context.font = LINE_NUMBER_FONT;
    context.fillText(String(startLine + index), gutterRight, baseline);
    context.textAlign = "left";
    context.font = CODE_FONT;
    const tokens = makeTokens(codeLines[index], language, lineState, colors);
    let x = codeStartX;
    for (const token of tokens) {
      context.fillStyle = token.color;
      context.fillText(token.text, x, baseline);
      x += context.measureText(token.text).width;
      if (x > width - RIGHT_PADDING) break;
    }
  }

  return { buffer: canvas.toBuffer("image/png"), width, height };
}

export async function renderCodeAsVscodeImages({ fileName, code, language: requestedLanguage, theme = "dark", workspaceDir } = {}) {
  if (typeof fileName !== "string" || !fileName.trim()) throw new Error("file_name is required.");
  if (typeof code !== "string") throw new Error("code must be a string.");
  if (theme !== "dark" && theme !== "light") throw new Error("theme must be 'dark' or 'light'.");
  const safeFileName = normalizeFileName(fileName);
  const sourceCode = code.replace(/\r\n?/g, "\n");
  if (!sourceCode.trim()) throw new Error("code cannot be empty.");
  if (sourceCode.length > MAX_CODE_CHARS) throw new Error(`Code is too long to render (${MAX_CODE_CHARS} characters maximum).`);
  const sourceLines = sourceCode.split("\n");
  if (sourceLines.length > MAX_CODE_LINES) throw new Error(`Code is too long to render (${MAX_CODE_LINES} lines maximum).`);
  if (!workspaceDir) throw new Error("The local workspace is not configured.");

  const language = normalizeLanguage(requestedLanguage, safeFileName);
  const safeTheme = theme === "light" ? "light" : "dark";
  const previewDirectory = path.join(workspaceDir, "Code Previews");
  await mkdir(previewDirectory, { recursive: true });
  const [realWorkspaceDirectory, realPreviewDirectory] = await Promise.all([
    realpath(workspaceDir),
    realpath(previewDirectory),
  ]);
  const previewRelativeToWorkspace = path.relative(realWorkspaceDirectory, realPreviewDirectory);
  if (!previewRelativeToWorkspace || previewRelativeToWorkspace.startsWith("..") || path.isAbsolute(previewRelativeToWorkspace)) {
    throw new Error("The code preview directory must remain inside the local workspace.");
  }
  const pageCount = Math.ceil(sourceLines.length / PAGE_LINES);
  const images = [];
  const id = randomUUID().slice(0, 8);

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const firstIndex = pageIndex * PAGE_LINES;
    const codeLines = sourceLines.slice(firstIndex, firstIndex + PAGE_LINES);
    const page = drawCodePreviewPage({
      codeLines,
      startLine: firstIndex + 1,
      language,
      theme: safeTheme,
    });
    const suffix = pageCount > 1 ? `-${String(pageIndex + 1).padStart(2, "0")}` : "";
    const imageName = `${path.parse(safeFileName).name}-vscode-preview-${id}${suffix}.png`;
    const imagePath = path.join(previewDirectory, imageName);
    await writeFile(imagePath, page.buffer, { flag: "wx" });
    images.push({
      fileName: imageName,
      path: imagePath,
      relativePath: path.relative(workspaceDir, imagePath).replaceAll("\\", "/"),
      width: page.width,
      height: page.height,
      firstLine: firstIndex + 1,
      lastLine: firstIndex + codeLines.length,
      sizeBytes: page.buffer.byteLength,
    });
  }

  return {
    ok: true,
    fileName: safeFileName,
    language,
    theme: safeTheme,
    lineCount: sourceLines.length,
    pageCount,
    images,
  };
}
