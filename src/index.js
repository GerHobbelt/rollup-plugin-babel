import * as babel from '@babel/core';
import { createFilter } from 'rollup-pluginutils';
import createPreflightCheck from './preflightCheck.js';
import helperPlugin from './helperPlugin.js';
import { escapeRegExpCharacters, warnOnce } from './utils.js';
import { RUNTIME, EXTERNAL, HELPERS } from './constants.js';

const unpackOptions = ({
	extensions = babel.DEFAULT_EXTENSIONS,
	// rollup uses sourcemap, babel uses sourceMaps
	// just normalize them here so people don't have to worry about it
	sourcemap = true,
	sourcemaps = true,
	sourceMap = true,
	sourceMaps = true,
	...rest
} = {}) => ({
	extensions,
	plugins: [],
	sourceMaps: sourcemap && sourcemaps && sourceMap && sourceMaps,
	...rest,
	caller: {
		name: 'rollup-plugin-babel',
		supportsStaticESM: true,
		supportsDynamicImport: true,
		...rest.caller,
	},
});

const returnObject = () => ({});

function createBabelPluginFactory(customCallback = returnObject) {
	const overrides = customCallback(babel);

	return pluginOptions => {
		let customOptions = null;

		if (overrides.customOptions) {
			({ custom: customOptions = null, plugin: pluginOptions } = overrides.customOptions(pluginOptions));
		}

		const {
			exclude,
			extensions,
			externalHelpers,
			externalHelpersWhitelist,
			include,
			runtimeHelpers,
			...babelOptions
		} = unpackOptions(pluginOptions);

		const extensionRegExp = new RegExp(`(${extensions.map(escapeRegExpCharacters).join('|')})$`);
		const includeExcludeFilter = createFilter(include, exclude);
		const filter = id => extensionRegExp.test(id) && includeExcludeFilter(id);
		const preflightCheck = createPreflightCheck();

		return {
			name: 'babel',
			resolveId(id) {
				if (id === HELPERS) return id;
			},
			load(id) {
				if (id !== HELPERS) {
					return;
				}

				return babel.buildExternalHelpers(externalHelpersWhitelist, 'module');
			},
			transform(code, filename) {
				if (!filter(filename)) return Promise.resolve(null);
				if (filename === HELPERS) return Promise.resolve(null);

				const helpers = preflightCheck(this, babelOptions, filename);

				// file was ignored
				if (!helpers) {
					return Promise.resolve(null);
				}

				if (helpers === EXTERNAL && !externalHelpers) {
					warnOnce(
						this,
						'Using "external-helpers" plugin with rollup-plugin-babel is deprecated, as it now automatically deduplicates your Babel helpers.',
					);
				} else if (helpers === RUNTIME && !runtimeHelpers) {
					this.error(
						'Runtime helpers are not enabled. Either exclude the transform-runtime Babel plugin or pass the `runtimeHelpers: true` option. See https://github.com/rollup/rollup-plugin-babel#configuring-babel for more information',
					);
				}

				const config = babel.loadPartialConfig({ ...babelOptions, filename });

				return Promise.resolve(
					!overrides.config
						? config.options
						: overrides.config.call(this, config, {
								code,
								customOptions,
						  }),
				).then(transformOptions => {
					transformOptions.plugins = (helpers !== RUNTIME
						? babelOptions.plugins.concat(helperPlugin)
						: babelOptions.plugins
					).concat(transformOptions.plugins);

					let result = babel.transform(code, transformOptions);

					if (!result) {
						return null;
					}

					return Promise.resolve(
						!overrides.result
							? result
							: overrides.result.call(this, result, {
									code,
									customOptions,
									config,
									transformOptions,
							  }),
					).then(result => ({ code: result.code, map: result.code }));
				});
			},
		};
	};
}

const babelPluginFactory = createBabelPluginFactory();
babelPluginFactory.custom = createBabelPluginFactory;

export default babelPluginFactory;
