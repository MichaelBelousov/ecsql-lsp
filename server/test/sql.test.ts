import * as TreeSitterParser from "tree-sitter";
import * as TreeSitterSql from "tree-sitter-sql";
import { expect } from "chai";
import { buildSuggestions, getCurrentSelectStatement, getQueriedProperties, processSchemaForSuggestions, SourceQuery, suggestForQueryEdit, SuggestionsCache, suggestQueryEditInDocument } from "../src/server";
import { CompletionItemKind } from 'vscode-languageserver';

const parser = new TreeSitterParser();
parser.setLanguage(TreeSitterSql);

function sourceToQuery(source: string): SourceQuery {
  const ast = parser.parse(source);
  return { ast, start: 0, end: source.length + 1, src: source, selectData: (s) => getCurrentSelectStatement(s, 0, ast) }
}

/** takes a document with a >|< string meaning the cursor position is over the next character (is the next character),
 * and gives you a chai Assertion to assert on. 
 * TODO: use the chai extension API instead */
async function expectFromQueryEditInDoc(doc: string, suggestions?: SuggestionsCache): Promise<Chai.Assertion> {
  const offset = doc.indexOf(">|<");
  doc = doc.replace(">|<", "");
  return expect(suggestQueryEditInDocument(suggestions ?? await buildTestSuggestions(), doc, offset));
}


async function buildTestSuggestions() {
  const suggestions: SuggestionsCache = {
    schemas: {},
    propertyToContainingClasses: new Map(),
    schemaAliases: new Map(),
  };

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
  it.skip("understand inner query", async () => {
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
  it.skip("simple", async () => {
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

  it.skip("empty from", async () => {
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

  it("biscore table suggestions", async () => {
    const suggestions = await buildSuggestions();

    (await expectFromQueryEditInDoc(
      `iModelDb.query("SELECT Model FROM bis.>|<");`,
      suggestions
    )).to.deep.equal([
      {
        label: "bis.Element",
        kind: CompletionItemKind.Class,
        insertText: "Element",
        documentation: "A bis:Element is the smallest individually identifiable building block for modeling the real world. "
          + "Each bis:Element represents an Entity in the real world. Sets of bis:Elements (contained in bis:Models) "
          + "are used to sub-model other bis:Elements that represent larger scale real world Entities. Using this recursive modeling strategy, "
          + "bis:Elements can represent Entities at any scale. Elements can represent physical things, abstract concepts or simply be information records.",
        detail: undefined
      }
    ]);

    (await expectFromQueryEditInDoc(
      `
      const result = iModelDb.query(
        "SELECT Model FROM BisCore.E>|< JOIN BisCore.Model m ON m.ECInstanceId=Model.Id"
      )
      `,
      suggestions
    )).to.deep.equal([
      {
        label: "BisCore.Element",
        kind: CompletionItemKind.Class,
        insertText: "lement",
        documentation: "A bis:Element is the smallest individually identifiable building block for modeling the real world. "
          + "Each bis:Element represents an Entity in the real world. Sets of bis:Elements (contained in bis:Models) "
          + "are used to sub-model other bis:Elements that represent larger scale real world Entities. Using this recursive modeling strategy, "
          + "bis:Elements can represent Entities at any scale. Elements can represent physical things, abstract concepts or simply be information records.",
        detail: undefined
      }
    ]);
  });

  it("biscore select suggestions", async () => {
    const suggestions = await buildSuggestions();

    (await expectFromQueryEditInDoc(
      `iModelDb.query("SELECT Model, Y>|< FROM bis.AuxCoordSystemSpatial");`,
      suggestions
    )).to.deep.equal([
      {
        label: "Yaw",
        kind: CompletionItemKind.Field,
        insertText: "Yaw",
        documentation: "The Yaw angle (in degrees) of the orientation of this Coordinate System",
        detail: undefined
      }
    ]);
  });

  it("biscore condition suggestions", async () => {
    const suggestions = await buildSuggestions();

    (await expectFromQueryEditInDoc(
      `iModelDb.query("SELECT Model FROM bis.Element WHERE ECInstanceId=>|<");`,
      suggestions
    )).to.deep.equal([
      {
        detail: "Last Modified",
        documentation: "The last modified time of the bis:Element. This is maintained by the core framework and should not be set directly by applications.",
        insertText: "LastMod",
        kind: CompletionItemKind.Field,
        label: "LastMod",
      },
      {
        detail: "Code",
        documentation: "The CodeValue property stores the formal name (business key) for a bis:Element. The combination of CodeSpec, CodeScope, and CodeValue properties must be unique for each bis:Element instance.",
        insertText: "CodeValue",
        kind: CompletionItemKind.Field,
        label: "CodeValue",
      },
      {
        detail: "User Label",
        documentation: "An optional friendly name given by the user (as opposed to the formal name stored in the CodeValue property).",
        insertText: "UserLabel",
        kind: CompletionItemKind.Field,
        label: "UserLabel",
      },
      {
        detail: "Federation GUID",
        documentation: "The GUID used to federate this bis:Element across repositories.",
        insertText: "FederationGuid",
        kind: CompletionItemKind.Field,
        label: "FederationGuid",
      },
      {
        detail: "JSON Properties",
        documentation: "A string property that users and/or applications can use to persist ad hoc JSON values.",
        insertText: "JsonProperties",
        kind: CompletionItemKind.Field,
        label: "JsonProperties",
      },
      {
        detail: undefined,
        documentation: "The bis:Model that contains this bis:Element.",
        insertText: "Model",
        kind: CompletionItemKind.Field,
        label: "Model",
      },
      {
        detail: "Code Specification",
        documentation: "The CodeSpec property identifies the bis:CodeSpec used to generate and validate the code for this bis:Element. The combination of CodeSpec, CodeScope, and CodeValue properties must be unique for each bis:Element instance.",
        insertText: "CodeSpec",
        kind: CompletionItemKind.Field,
        label: "CodeSpec",
      },
      {
        detail: "Code Scope",
        documentation: "The CodeScope property identifies the bis:Element that provides the uniqueness scope for the code value. The combination of CodeSpec, CodeScope, and CodeValue properties must be unique for each bis:Element instance.",
        insertText: "CodeScope",
        kind: CompletionItemKind.Field,
        label: "CodeScope",
      },
      {
        detail: undefined,
        documentation: "The parent bis:Element that owns this bis:Element.",
        insertText: "Parent",
        kind: CompletionItemKind.Field,
        label: "Parent",
      },
      {
        insertText: "Model",
        kind: CompletionItemKind.Field,
        label: "Model",
      }
    ]);
  });
});