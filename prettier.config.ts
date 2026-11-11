import type { Config } from 'prettier';
import type { PluginOptions } from 'prettier-plugin-tailwindcss';

const config: Config & PluginOptions = {
  printWidth: 100,
  singleQuote: true,
  // Sorts Tailwind classes in the order Tailwind applies them.
  plugins: ['prettier-plugin-tailwindcss'],
  tailwindStylesheet: './src/app/globals.css',
};

export default config;
