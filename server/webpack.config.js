const webpack = require("webpack");
const CopyWebpackPlugin = require("copy-webpack-plugin");

/** @type {import("webpack").Configuration} */
module.exports = {
  // have to override output which will be incorrect main.ts
  entry: "./src/server.ts",
  output: {
    libraryTarget: "commonjs2",
    filename: "main.js",
    chunkFilename: "[name].chunk.js",
  },
  watchOptions: {
    ignored: "**/node_modules",
  },
  externals: ["vscode"],
  mode: process.env.NODE_ENV || "production",
  resolve: { extensions: [".ts", ".js"] },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: "ts-loader",
      },
      {
        test: /\.xml$/,
        // TODO: move to webpack 5 asset modules
        use: "raw-loader",
      },
    ],
  },
  target: "node",
  devtool:
    process.env.NODE_ENV === "development" ? "inline-source-map" : undefined,
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        {
          from: "../node-tree-sitter/prebuilds",
          to: "node_modules/node-tree-sitter/prebuilds",
        },
        {
          from: "../tree-sitter-sql/prebuilds",
          to: "node_modules/tree-sitter-sql/prebuilds",
        },
      ],
    }),
    new webpack.DefinePlugin({
      "process.env.IN_WEBPACK": JSON.stringify(1), // expose whether we're in webpack for prebuildify/node-gyp-build using dependencies
    }),
  ],
};
