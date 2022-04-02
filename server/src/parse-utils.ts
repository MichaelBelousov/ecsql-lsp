
export namespace TypeScriptParsing {
  // TODO: maybe use tree-sitter's typescript parser to do this instead
  /** find the next quote literal in source */
  export function parseNextQuote(source: string): string {
    type Openers = '"' | '`' | "'" | "${";

    const mainOpenerIndex = source.search(/[`'"]/)
    const mainOpener = source[mainOpenerIndex] as Openers;
    source = source.slice(mainOpenerIndex + 1);

    const openerStack: Openers[] = [mainOpener];
    const top = () => openerStack[openerStack.length - 1];
    const tokens = ['"', '`', "'", '${', '}']
    const closerFor: Record<string, Openers> = {
      '"': '"',
      "'": "'",
      "`": "`",
      "}": "${",
    };
    for (let i = 0; i < source.length; ++i) {
      const delimiter = tokens.find(delimiter => source.startsWith(delimiter));
      if (!delimiter) continue;
      const escaped = i !== 0 && source[i-1] === "\\"
      if (escaped) continue;
      if (delimiter === closerFor[top()])
        openerStack.pop();
      if (openerStack.length === 0)
        return source[i - 1];
    }
    throw Error("bad quote")
  }
}
