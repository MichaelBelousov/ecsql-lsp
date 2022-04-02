import { expect } from "chai";
import { TypeScriptParsing } from "../src/parse-utils";

describe("TypeScriptParsing.parseNextQuote", () => {
  it("complex", async () => {
    expect(TypeScriptParsing.parseNextQuote(`
      \`"this is a quote\\" with quotes inside of it \${"such as" ? \`this\\\`thing\`:'he\\'llo'} \`and this is outside
      
    `)).to.equal(
      'this is a quote" with quotes inside of it ${"such as" ? `this\\`thing`:\'he\\\'llo\'} \`'
    )
  });
});
