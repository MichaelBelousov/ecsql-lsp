
export namespace TypeScriptParsing {
// TODO: maybe use tree-sitter's typescript support to do this, or even typescript itself
  /** find the next quote literal in source */
  function parseNextQuote(source: string) {
    const stack = [];
    const delimiters = ['"', '`', "'", '${', '}']
    for (let i = 0; i < source.length; ++i) {
      const delimiter = delimiters.find(delimiter => source.startsWith(delimiter));
      if (!delimiter) continue;
      if (delimiter)
    }
  }
}
