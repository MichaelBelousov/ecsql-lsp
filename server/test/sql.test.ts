import * as jssqlparser from "js-sql-parser";
import * as pgsqlparser from "pg-query-parser";
import * as sqlparser from "sql-parse";
import * as TreeSitterParser from "tree-sitter";
import * as TreeSitterSql from "tree-sitter-sql";
import * as TreeSitterSqlite from "tree-sitter-sqlite";
import { Parser as SqlParser, Column } from "node-sql-parser";
import { assert, expect } from "chai";

// TODO: pick only one sql parser

// js sql-parser has no locations
describe("js-sql-parser", () => {
  it("parsed column names", async () => {
    const ast = jssqlparser.parse(`
      SELECT col1, col2 AS colB, (SELECT 1) AS col3 FROM some.table;
    `);
    const maybeAliased = (col: any) => col.alias ?? col.value;
    expect(maybeAliased(ast.value.selectItems.value[0])).to.equal("col1");
    expect(maybeAliased(ast.value.selectItems.value[1])).to.equal("colB");
    expect(maybeAliased(ast.value.selectItems.value[2])).to.equal("col3");
  });
})

describe("pg-query-parser", () => {
  it("parsed column names", async () => {
    // well this parser can't parse names with /\.:/ in them...
    const ast = pgsqlparser.parse(`
      SELECT col1, col2 AS colB, (SELECT 1) AS col3 FROM some:table;
    `);
    //const maybeAliased = (col: any) => col.alias ?? col.value;
    expect(ast.queries[0].SelectStmt.fromClause[0].RangeVar.relname).to.equal("some.table");
    expect(ast.value.selectItems.value[1]).to.equal("colB");
    expect(ast.value.selectItems.value[2]).to.equal("col3");
  });
})

describe("node-sql-parser", () => {
  it("parsed column names", async () => {
    const parser = new SqlParser();
    const ast = parser.astify(`
      SELECT col1, col2 AS colB, (SELECT 1) AS col3 FROM some_table
    `);
    const maybeAliased = (col: Column | false) => col === false ? undefined : col.as ?? (col.expr.type === "column_ref" ? col.expr.column : col.expr);
    expect(maybeAliased(!Array.isArray(ast) && ast.type === "select" && Array.isArray(ast.columns) && (ast.columns as Column[])[0])).to.equal("col1");
    expect(maybeAliased(!Array.isArray(ast) && ast.type === "select" && Array.isArray(ast.columns) && (ast.columns as Column[])[1])).to.equal("colB");
    expect(maybeAliased(!Array.isArray(ast) && ast.type === "select" && Array.isArray(ast.columns) && (ast.columns as Column[])[2])).to.equal("col3");
  });
});

describe("sql-parse", () => {
  it("parsed column names", async () => {
    const ast = sqlparser.parse(`
      SELECT col1, col2 AS colB, (SELECT 1) AS col3 FROM some.table
    `);
    const maybeAliased = (col: Column | false) => col === false ? undefined : col.as ?? (col.expr.type === "column_ref" ? col.expr.column : col.expr);
    expect(maybeAliased(!Array.isArray(ast) && ast.type === "select" && Array.isArray(ast.columns) && (ast.columns as Column[])[0])).to.equal("col1");
    expect(maybeAliased(!Array.isArray(ast) && ast.type === "select" && Array.isArray(ast.columns) && (ast.columns as Column[])[1])).to.equal("colB");
    expect(maybeAliased(!Array.isArray(ast) && ast.type === "select" && Array.isArray(ast.columns) && (ast.columns as Column[])[2])).to.equal("col3");
  });
});

describe("tree-sittersqlite", () => {
  it("parsed column names", () => {
    const parser = new TreeSitterParser();
    parser.setLanguage(TreeSitterSqlite);
    const ast = parser.parse(`
      SELECT col1, col2 AS colB, (SELECT 1) AS col3 FROM some.table
    `);
    expect(ast.rootNode.namedChild(0)?.namedChild(0)?.namedChild(1)?.text).to.equal("col1");
    expect(ast.rootNode.namedChild(0)?.namedChild(0)?.namedChild(4)?.text).to.equal("colB");
    expect(ast.rootNode.namedChild(0)?.namedChild(0)?.namedChild(7)?.text).to.equal("col3");
    const getCols = new TreeSitterParser.Query(TreeSitterSqlite, "(select_statement) @test");
    expect(getCols.matches(ast.rootNode)[0].captures[0].node).not.to.be.undefined;
    ast.rootNode.firstChildForIndex
  });
});

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