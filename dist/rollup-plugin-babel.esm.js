import { join, dirname } from 'path';
import { transform, buildExternalHelpers, DEFAULT_EXTENSIONS, loadPartialConfig } from '@gerhobbelt/babel-core';
import { addNamed } from '@gerhobbelt/babel-helper-module-imports';
import { createFilter } from 'rollup-pluginutils';

var INLINE = {};
var RUNTIME = {};
var EXTERNAL = {};

// NOTE: DO NOT REMOVE the null character `\0` as it may be used by other plugins
// e.g. https://github.com/rollup/rollup-plugin-node-resolve/blob/313a3e32f432f9eb18cc4c231cc7aac6df317a51/src/index.js#L74
var HELPERS = '\0rollupPluginBabelHelpers';

var MODULE_ERROR =
	'Rollup requires that your Babel configuration keeps ES6 module syntax intact. ' +
	'Unfortunately it looks like your configuration specifies a module transformer ' +
	'to replace ES6 modules with another module format. To continue you have to disable it.' +
	'\n\n' +
	'Most commonly it\'s a CommonJS transform added by @gerhobbelt/babel-preset-env - ' +
	'in such case you should disable it by adding `modules: false` option to that preset ' +
	'(described in more detail here - https://github.com/rollup/rollup-plugin-babel#modules ).';

var UNEXPECTED_ERROR =
	'An unexpected situation arose. Please raise an issue at ' +
	'https://github.com/rollup/rollup-plugin-babel/issues. Thanks!';

function fallbackClassTransform () {
	return {
		visitor: {
			ClassDeclaration: function ClassDeclaration (path, state) {
				path.replaceWith(state.file.addHelper('inherits'));
			}
		}
	};
}

function createPreflightCheck () {
	var preflightCheckResults = {};

	return function ( ctx, options, dir ) {
		if ( !preflightCheckResults[ dir ] ) {
			var helpers;

			options = Object.assign( {}, options );
			delete options.only;
			delete options.ignore;

			options.filename = join( dir, 'x.js' );

			var inputCode = 'class Foo extends Bar {};\nexport default Foo;';
			var check = transform( inputCode, options ).code;

			if ( ~check.indexOf('class ') ) {
				options.plugins = (options.plugins || []).concat( fallbackClassTransform );
				check = transform( inputCode, options ).code;
			}

			if (
				!~check.indexOf( 'export default' ) &&
				!~check.indexOf( 'export default Foo' ) &&
				!~check.indexOf( 'export { Foo as default }' )
			) {
				ctx.error( MODULE_ERROR );
			}

			if ( check.match( /\/helpers\/(esm\/)?inherits/ ) ) { helpers = RUNTIME; }
			else if ( ~check.indexOf( 'function _inherits' ) ) { helpers = INLINE; }
			else if ( ~check.indexOf( 'babelHelpers' ) ) { helpers = EXTERNAL; }
			else {
				ctx.error( UNEXPECTED_ERROR );
			}

			preflightCheckResults[ dir ] = helpers;
		}

		return preflightCheckResults[ dir ];
	};
}

function importHelperPlugin () {
	return {
		pre: function pre (file) {
			var cachedHelpers = {};
			file.set('helperGenerator', function (name) {
				if (cachedHelpers[name]) {
					return cachedHelpers[name];
				}
				return (cachedHelpers[name] = addNamed(file.path, name, HELPERS));
			});
		},
	};
}

var warned = {};
function warnOnce ( ctx, msg ) {
	if ( warned[ msg ] ) { return; }
	warned[ msg ] = true;
	ctx.warn( msg );
}

var regExpCharactersRegExp = /[\\^$.*+?()[\]{}|]/g;
var escapeRegExpCharacters = function (str) { return str.replace(regExpCharactersRegExp, '\\$&'); };

function objectWithoutProperties (obj, exclude) { var target = {}; for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k) && exclude.indexOf(k) === -1) target[k] = obj[k]; return target; }

var unpackOptions = function (ref) {
	if ( ref === void 0 ) ref = {};
	var extensions = ref.extensions; if ( extensions === void 0 ) extensions = DEFAULT_EXTENSIONS;
	var sourcemap = ref.sourcemap; if ( sourcemap === void 0 ) sourcemap = true;
	var sourcemaps = ref.sourcemaps; if ( sourcemaps === void 0 ) sourcemaps = true;
	var sourceMap = ref.sourceMap; if ( sourceMap === void 0 ) sourceMap = true;
	var sourceMaps = ref.sourceMaps; if ( sourceMaps === void 0 ) sourceMaps = true;
	var rest$1 = objectWithoutProperties( ref, ["extensions", "sourcemap", "sourcemaps", "sourceMap", "sourceMaps"] );
	var rest = rest$1;

	return (Object.assign({}, {extensions: extensions,
	plugins: [],
	sourceMaps: sourcemap && sourcemaps && sourceMap && sourceMaps},
	rest,
	{caller: Object.assign({}, {name: 'rollup-plugin-babel',
		supportsStaticESM: true,
		supportsDynamicImport: true},
		rest.caller)}));
};

function babel ( options ) {
	// TODO: remove it later, just provide a helpful warning to people for now
	try {
		loadPartialConfig({
			caller: undefined,
			babelrc: false,
			configFile: false,
		});
	} catch (err) {
		throw new Error('You should be using @gerhobbelt/babel-core@^7.0.0. Please upgrade or pin rollup-plugin-babel to 4.0.0-beta.8');
	}

	var ref = unpackOptions(options);
	var exclude = ref.exclude;
	var extensions = ref.extensions;
	var externalHelpers = ref.externalHelpers;
	var externalHelpersWhitelist = ref.externalHelpersWhitelist;
	var include = ref.include;
	var runtimeHelpers = ref.runtimeHelpers;
	var rest = objectWithoutProperties( ref, ["exclude", "extensions", "externalHelpers", "externalHelpersWhitelist", "include", "runtimeHelpers"] );
	var babelOptions = rest;

	var extensionRegExp = new RegExp(("(" + (extensions.map(escapeRegExpCharacters).join('|')) + ")$"));
	var includeExcludeFilter = createFilter( include, exclude );
	var filter = function (id) { return extensionRegExp.test(id) && includeExcludeFilter(id); };
	var preflightCheck = createPreflightCheck();

	return {
		name: 'babel',

		resolveId: function resolveId ( id ) {
			if ( id === HELPERS ) { return id; }
		},

		load: function load ( id ) {
			if ( id !== HELPERS ) {
				return;
			}

			return buildExternalHelpers( externalHelpersWhitelist, 'module' );
		},

		transform: function transform$1 ( code, id ) {
			if ( !filter( id ) ) { return null; }
			if ( id === HELPERS ) { return null; }

			var helpers = preflightCheck( this, babelOptions, dirname( id ) );

			if ( helpers === EXTERNAL && !externalHelpers ) {
				warnOnce( this, 'Using "external-helpers" plugin with rollup-plugin-babel is deprecated, as it now automatically deduplicates your Babel helpers.' );
			} else if ( helpers === RUNTIME && !runtimeHelpers ) {
				this.error( 'Runtime helpers are not enabled. Either exclude the transform-runtime Babel plugin or pass the `runtimeHelpers: true` option. See https://github.com/rollup/rollup-plugin-babel#configuring-babel for more information' );
			}

			var localOpts = Object.assign({}, {filename: id},
				babelOptions,
				{plugins: helpers !== RUNTIME
					? babelOptions.plugins.concat( [importHelperPlugin])
					: babelOptions.plugins});

			var transformed = transform( code, localOpts );

			if (!transformed) {
				return { code: code };
			}

			return {
				code: transformed.code,
				map: transformed.map
			};
		}
	};
}

export default babel;
//# sourceMappingURL=rollup-plugin-babel.esm.js.map
