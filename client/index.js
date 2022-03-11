module.exports = process.env.NO_WEBPACK // TODO: better name... maybe just use NODE_ENV===development
  ? require("./out/extension")
  : require("./dist/extension.js");
