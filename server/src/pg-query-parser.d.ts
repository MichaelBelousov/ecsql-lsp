
// TODO: contribute to definitely typed once it's relatively complete
declare module "pg-query-parser" {
  interface Parser {
    parse(str: string): any;
    deparser(ast: any): string;
  }

  const sqlparser: Parser;

  export = sqlparser;
}
