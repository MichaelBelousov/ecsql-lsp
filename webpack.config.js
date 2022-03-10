const path = require("path");

/** @type {import("webpack").Configuration} */
module.exports = {
  // have to override output which will be incorrect main.ts
  entry: "./client/src/extension.ts",
  output: {
    libraryTarget: "commonjs2",
    // The build folder.
    // Next line is not used in dev but WebpackDevServer crashes without it:
    //path: "out-test",
    // The name of the output bundle.
    filename: "main.js",
    // There are also additional JS chunk files if you use code splitting.
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
        use: [
          {
            loader: "ts-loader",
            /** @type {import("ts-loader").Options} */
            options: {
              configFile: "tsconfig.json",
              // not ideal, but I'm too lazy to figure out how to properly webpack@4 it
              allowTsInNodeModules: true,
            },
          },
        ],
        // not ideal, but I'm too lazy to figure out how to properly webpack@4 it
        // or switch to webpack@5 for just the backend to see if that works
        include: [path.resolve(__dirname, "./client/src")],
        //exclude: /node_modules/,
      },
    ],
  },
  target: "node",
  devtool: process.env.NODE_ENV === "development" ? "source-map" : undefined,
};
