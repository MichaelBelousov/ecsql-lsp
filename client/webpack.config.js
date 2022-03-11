const webpack = require("webpack");

/** @type {import("webpack").Configuration} */
module.exports = {
  // have to override output which will be incorrect main.ts
  entry: "./src/extension.ts",
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
        use: [{ loader: "ts-loader" }],
      },
    ],
  },
  target: "node",
  devtool: process.env.NODE_ENV === "development" ? "source-map" : undefined,
};
