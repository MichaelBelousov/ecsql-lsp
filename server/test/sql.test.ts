import * as TreeSitterParser from "tree-sitter";
import * as TreeSitterSql from "tree-sitter-sql";
import { assert, expect } from "chai";

describe.only("tree-sitter-sql", () => {
  it("parsed column names", () => {
    const parser = new TreeSitterParser();
    parser.setLanguage(TreeSitterSql);
    const source = `
      SELECT col1, col2 AS colB, (SELECT 1) AS col3 FROM some.table
    `;
    const ast = parser.parse(source);
    const query = new TreeSitterParser.Query(TreeSitterSql, "(select_clause_body [(identifier) (alias)] @col)");
    const matches = query.matches(ast.rootNode);
    console.log("test2");
    const dealias = (obj: any) => (obj.type === "alias" ? obj.lastNamedChild : obj).text;
    expect(dealias(matches[0].captures[0].node)).to.equal("col1");
    expect(dealias(matches[1].captures[0].node)).to.equal("colB");
    expect(dealias(matches[2].captures[0].node)).to.equal("col3");
  });
});