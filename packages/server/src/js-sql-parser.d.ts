
// TODO: contribute to definitely typed once it's relatively complete
declare module "js-sql-parser" {
  type SqlValue = any; //SqlAstNode | string | number | SqlAstNode[] | string[] | number[];

  interface SqlAstNode {
    value: SqlValue;
    [k: string]: SqlValue;
  }

  interface SqlAst {
    value: {
      selectItems: SqlAstNode;
      from: SqlAstNode
    }
  }

  interface Parser {
    parse(str: string): SqlAst;
    stringify(ast: SqlAst): string;
  }

  const parser: Parser;

  export = parser;
}
