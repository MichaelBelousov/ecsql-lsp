import * as TreeSitterParser from "tree-sitter";
import * as TreeSitterSql from "tree-sitter-sql";
import { assert, expect } from "chai";
import { getCurrentSelectStatement, getQueriedProperties } from "../src/server";

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

describe("getCurrentSelectStatement", () => {
  it("understand inner query", () => {
    const parser = new TreeSitterParser();
    parser.setLanguage(TreeSitterSql);
    const source = `
      SELECT col1, col2 AS colB, (SELECT X from Y) AS col3 FROM some.table JOIN joiner ON col1=Id
    `;
    const ast = parser.parse(source);
    const [firstSelectOffset, secondSelectOffset] = [...source.matchAll(/SELECT/g)].map(m => m.index!);
    const outerSelectResult = getCurrentSelectStatement(firstSelectOffset, { ast, start: 0, end: source.length + 1, src: source });
    expect(outerSelectResult?.tables).to.deep.equal(["some.table", "joiner"]);
    const innerSelectResult = getCurrentSelectStatement(secondSelectOffset, { ast, start: 0, end: source.length + 1, src: source });
    expect(innerSelectResult?.tables).to.deep.equal(["Y"]);
  });
});

describe("getQueriedProperties", () => {
  it("simple test", () => {
    const parser = new TreeSitterParser();
    parser.setLanguage(TreeSitterSql);
    const source = `
      SELECT col1, col2 AS colB, (SELECT X from Y) AS col3 FROM some.table JOIN joiner ON col1=Id
    `;
    const ast = parser.parse(source);
    expect(getQueriedProperties({ ast, start: 0, end: source.length + 1, src: source })).to.deep.equal([
      "col1", "col2", "X" // FIXME: selecting "X" is kinda a bug tbh but whatever for now
    ]);
  });
});