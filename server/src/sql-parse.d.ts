
// TODO: contribute to definitely typed once it's relatively complete
declare module "sql-parse" {
  interface Parser {
    parse(str: string): any;
  }

  const sqlparser: Parser;

  export = sqlparser;
}
