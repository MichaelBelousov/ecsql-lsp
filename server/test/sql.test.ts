import * as TreeSitterParser from "tree-sitter";
import * as TreeSitterSql from "tree-sitter-sql";
import { assert, expect } from "chai";
import { getCurrentSelectStatement, getQueriedProperties, processSchemaForSuggestions, SourceQuery, suggestForQueryEdit, SuggestionsCache } from "../src/server";
import { CompletionItemKind } from 'vscode-languageserver';

const parser = new TreeSitterParser();
parser.setLanguage(TreeSitterSql);

function sourceToQuery(source: string): SourceQuery {
  const ast = parser.parse(source);
  return { ast, start: 0, end: source.length + 1, src: source, selectData: (s) => getCurrentSelectStatement(s, 0, ast) }
}

async function buildTestSuggestions() {
  const suggestions: SuggestionsCache = { schemas: {}, propertyToContainingClasses: new Map() };

  await processSchemaForSuggestions(`<?xml version="1.0" encoding="UTF-8"?>
    <ECSchema schemaName="MySchema" alias="ms" version="01.00.00" xmlns="http://www.bentley.com/schemas/Bentley.ECXML.3.1">
      <ECEntityClass typeName="A" modifier="Sealed" displayLabel="class A" description="description of class A">
        <ECProperty propertyName="G" typeName="string" description="Description of property G" />
        <ECProperty propertyName="H" typeName="string" description="Description of property H" />
      </ECEntityClass>
      <ECEntityClass typeName="B" modifier="Sealed" displayLabel="class B" description="description of class B">
        <ECProperty propertyName="I" typeName="string" description="Description of property I" />
        <ECProperty propertyName="J" typeName="string" description="Description of property J" />
      </ECEntityClass>
    </ECSchema>`,
    suggestions
  );

  return suggestions;
}


describe("tree-sitter-sql", () => {
  it("parsed column names", async () => {
    const query = new TreeSitterParser.Query(TreeSitterSql, "(select_clause_body [(identifier) (alias)] @col)");
    const source = sourceToQuery(`
      SELECT col1, col2 AS colB, (SELECT 1) AS col3 FROM some.table
    `);
    const matches = query.matches(source.ast.rootNode);
    console.log("test2");
    const dealias = (obj: any) => (obj.type === "alias" ? obj.lastNamedChild : obj).text;
    expect(dealias(matches[0].captures[0].node)).to.equal("col1");
    expect(dealias(matches[1].captures[0].node)).to.equal("colB");
    expect(dealias(matches[2].captures[0].node)).to.equal("col3");
  });
});

describe("getCurrentSelectStatement", () => {
  it("understand inner query", async () => {
    const source = sourceToQuery(`
      SELECT col1, col2 AS colB, (SELECT X from Y) AS col3 FROM some.table JOIN joiner ON col1=Id
    `);
    const [firstSelectOffset, secondSelectOffset] = [...source.src.matchAll(/SELECT/g)].map(m => m.index!);
    const outerSelectResult = getCurrentSelectStatement(await buildTestSuggestions(), firstSelectOffset, source.ast);
    expect(outerSelectResult?.tables).to.deep.equal(["some.table", "joiner"]);
    const innerSelectResult = getCurrentSelectStatement(await buildTestSuggestions(), secondSelectOffset, source.ast);
    expect(innerSelectResult?.tables).to.deep.equal(["Y"]);
  });
});

describe("getQueriedProperties", () => {
  it("simple test", async () => {
    const query = sourceToQuery(`
      SELECT col1, col2 AS colB, (SELECT X from Y) AS col3 FROM some.table JOIN joiner ON col1=Id
    `);
    expect(getQueriedProperties(query)).to.deep.equal([
      "col1", "col2", "X" // FIXME: selecting "X" is kinda a bug tbh but whatever for now
    ]);
  });
});

describe("suggestForQueryEdit", async () => {
  it("simple", async () => {
    const query = sourceToQuery(`
      SELECT G FROM MySchema.A
    `);

    const suggestions = await buildTestSuggestions();

    expect(
      suggestForQueryEdit(suggestions, query, query.src.indexOf("G"))
    ).to.deep.equal(
      // FIXME: should not recommend an proeperty that is already selected (G)
      [{
        label: "G",
        kind: CompletionItemKind.Field,
        insertText: "G",
        documentation: "Description of property G",
        detail: undefined
      },
      {
        label: "H",
        kind: CompletionItemKind.Field,
        insertText: "H",
        documentation: "Description of property H",
        detail: undefined
      }]
    );

    expect(
      suggestForQueryEdit(suggestions, query, query.src.indexOf("A"))
    ).to.deep.equal(
      // FIXME: should not recommend a table already in the FROM clause (A)
      [{
        label: "MySchema.A",
        kind: CompletionItemKind.Class,
        insertText: "MySchema.A",
        documentation: "description of class A",
        detail: "class A"
      }]
      // B isn't suggested because none of its properties are selected by SELECT
    )
  });

  it("empty from", async () => {
    const query = sourceToQuery(`
      SELECT I FROM
    `);

    const suggestions = await buildTestSuggestions();

    expect(
      suggestForQueryEdit(suggestions, query, query.src.length - 1)
    ).to.deep.equal(
      [{
        label: "MySchema.B",
        kind: CompletionItemKind.Class,
        insertText: "MySchema.B",
        documentation: "description of class B",
        detail: "class B"
      }]
    )
  });
});