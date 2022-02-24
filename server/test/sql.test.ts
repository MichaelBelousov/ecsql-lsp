import * as sqlparser from "js-sql-parser";
import { expect } from "chai";

describe("", () => {
  it("parsed column names", async () => {
    const ast = sqlparser.parse(`
      SELECT col1, col2 AS colB, (SELECT 1) AS col3 FROM some.table;
    `);
    const maybeAliased = (col: any) => col.alias ?? col.value;
    expect(maybeAliased(ast.value.selectItems.value[0])).to.equal("col1");
    expect(maybeAliased(ast.value.selectItems.value[1])).to.equal("colB");
    expect(maybeAliased(ast.value.selectItems.value[2])).to.equal("col3");
  });
  // so the idea would be to pull and cache a revision of https://github.com/iTwin/bis-schemas
  // and parse the XML there for schema names/aliases, class properties, etc
  // also checkout the apollo graphql plugin for embedded languages
})