/**
 * typed-function
 *
 * Type checking for JavaScript functions
 *
 * https://github.com/josdejong/typed-function
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    // AMD. Register as an anonymous module.
    define([], factory);
  } else if (typeof exports === 'object') {
    // Node. Does not work with strict CommonJS, but
    // only CommonJS-like environments that support module.exports,
    // like Node.
    module.exports = factory();
  } else {
    // Browser globals (root is window)
    root.typed = factory();
  }
}(this, function () {
  'use strict';

  // order types
  // anytype (*) will be ordered last, and then object, as other types may be
  // an object too.
  function compareTypes(a, b) {
    if (a === '*') return 1;
    if (b === '*') return -1;

    if (a === 'Object') return 1;
    if (b === 'Object') return -1;

    return 0;
  }

  /**
   * Get a type test function for a specific data type
   * @param {string} type                   A data type like 'number' or 'string'
   * @returns {function(obj: *) : boolean}  Returns a type testing function.
   *                                        Throws an error for an unknown type.
   */
  function getTypeTest(type) {
    var test = typed.types[type];
    if (!test) {
      var matches = Object.keys(typed.types)
          .filter(function (t) {
            return t.toLowerCase() == type.toLowerCase();
          })
          .map(function (t) {
            return '"' + t + '"';
          });

      throw new Error('Unknown type "' + type + '"' +
          (matches.length ? ('. Did you mean ' + matches.join(', or ') + '?') : ''));
    }
    return test;
  }

  // order numbers
  function compareNumbers(a, b) {
    return a > b;
  }

  /**
   * Collection with function references (local shortcuts to functions)
   * @constructor
   * @param {string} [name='refs']  Optional name for the refs, used to generate
   *                                JavaScript code
   */
   // TODO: rename Refs to Refs
  function Refs(name) {
    this.name = name || 'refs';
    this.categories = {};
  }

  /**
   * Add a function reference.
   * @param {function} fn
   * @param {string} [category='fn']    A function category, like 'fn' or 'signature'
   * @returns {string} Returns the function name, for example 'fn0' or 'signature2'
   */
  Refs.prototype.add = function (fn, category) {
    var cat = category || 'fn';
    if (!this.categories[cat]) this.categories[cat] = [];

    var index = this.categories[cat].indexOf(fn);
    if (index == -1) {
      index = this.categories[cat].length;
      this.categories[cat].push(fn);
    }
    
    return cat + index;
  };

  /**
   * Create code lines for all function references
   * @returns {string} Returns the code containing all function references
   */
  Refs.prototype.toCode = function () {
    var code = [];
    var path = this.name + '.categories';
    var categories = this.categories;

    Object.keys(categories).forEach(function (cat) {
      var def = categories[cat];
      def.forEach(function (def, index) {
        code.push('var ' + cat + index + ' = ' + path + '[\'' + cat + '\'][' + index + '];');
      });
    });
    
    return code.join('\n');
  };

  /**
   * A function parameter
   * @param {string | string[] | Param} types    A parameter type like 'string',
   *                                             'number | boolean'
   * @constructor
   */
  function Param(types) {
    // parse the types, can be a string with types separated by pipe characters |
    if (typeof types === 'string') {
      this.types = types.split('|').map(function (type) {
        return type.trim();
      });
    }
    else if (Array.isArray(types)) {
      this.types = types;
    }
    else if (types instanceof Param) {
      this.types = types.types;
    }
    else {
      throw new Error('String or Array expected');
    }

    // parse varArgs operator (ellipses '...')
    this.varArgs = false;
    this.types.forEach(function (type, index) {
      if (type.substring(type.length - 3) == '...') {
        if (index === this.types.length - 1) {
          this.types[index] = type.substring(0, type.length - 3);
          this.varArgs = true;
        }
        else {
          throw new SyntaxError('Unexpected varArgs "..."');
        }
      }
    }.bind(this));
  }

  /**
   * Return a string representation of this params types, like 'string' or
   * 'number | boolean'
   * @returns {string}
   */
  Param.prototype.toString = function () {
    return this.types.join('|');
  };

  /**
   * A function signature
   * @param {string | string[]} params  Array with the type(s) of each parameter,
   *                                    or a comma separated string with types
   * @param {function} fn               The actual function
   * @constructor
   */
  function Signature(params, fn) {
    if (typeof params === 'string') {
      this.params = (params !== '') ? params.split(',').map(function (types) {
        return new Param(types);
      }) : [];
    }
    else if (Array.isArray(params)) {
      this.params = params.map(function (types) {
        return new Param(types);
      });
    }
    else {
      throw new Error('string or Array expected');
    }
    
    // check varArgs operator '...'
    var withVarArgs = this.params.filter(function (param) {
      return param.varArgs;
    });
    if (withVarArgs.length === 0) {
      this.varArgs = false;
    }
    else if (withVarArgs[0] === this.params[this.params.length - 1]) {
      this.varArgs = true;
    }
    else {
      throw new SyntaxError('Unexpected varArgs "..."');
    }

    this.fn = fn;
  }

  // TODO: implement function Signature.merge
  // TODO: implement function Signature.toString

  /**
   * Split params with multiple types in separate signatures,
   * for example split a Signature "string | number" into two signatures.
   * @return {Signature[]} Returns an array with signatures (at least one)
   */
  Signature.prototype.split = function () {
    var signatures = [];

    function _iterate(signature, types, index) {
      if (index < signature.params.length) {
        var param = signature.params[index];
        param.types.forEach(function (type) {
          _iterate(signature, types.concat(type), index + 1);
        });
      }
      else {
        signatures.push(new Signature(types, signature.fn));
      }
    }
    _iterate(this, [], 0);

    return signatures;
  };

  /**
   * A node is used to create a node tree to recursively traverse parameters
   * of a function. Nodes have either:
   * - Child nodes in a map `types`.
   * - No child nodes but a function `fn`, the function to be called for 
   *   This signature.
   * @param {string[]} [signature]   An optional array with types of the
   *                                 signature up to this child node.
   */ 
  function Node (signature) {
    this.signature = signature || [];
    this.fn = null;
    this.childs = {};
  }
    
  /**
   * Returns a string with JavaScript code for this function
   * @param {Refs} refs     Object to store function references
   * @param {string[]} args Argument names, like ['arg0', 'arg1', ...]
   * @param {string} prefix A number of spaces to prefix for every line of code
   * @return {string} code
   */
  Node.prototype.toCode = function (refs, args, prefix) {
    var code = [];
    var childs = this.childs;

    if (this.fn !== null) {
      var def = refs.add(this.fn, 'signature');
      code.push(prefix + 'return ' + def + '(' + args.join(', ') + '); // signature: ' + this.signature);
    }
    else {
      // add entries for the provided childs
      Object.keys(childs)
          .sort(compareTypes)
          .forEach(function (type, index) {
            var arg = 'arg' + args.length;

            var before;
            var after;
            var nextPrefix = prefix + '  ';
            if (type == '*') {
              before = (index > 0 ? 'else {' : '');
              after  = (index > 0 ? '}' : '');
              if (index === 0) {nextPrefix = prefix;}
            }
            else {
              var def = refs.add(getTypeTest(type), 'test') + '(' + arg + ')';
              before = 'if (' + def + ') { // type: ' + type;
              after  = '}';
            }

            if (before) code.push(prefix + before);
            code = code.concat(childs[type].toCode(refs, args.concat(arg), nextPrefix));
            if (after) code.push(prefix + after);
          });

      // add entries for type conversions
      var added = {};
      typed.conversions
          .filter(function (conversion) {
            return childs[conversion.to] && !childs[conversion.from];
          })
          .forEach(function (conversion) {
            if (!added[conversion.from]) {
              added[conversion.from] = true;

              var arg = 'arg' + args.length;
              var test = refs.add(getTypeTest(conversion.from), 'test') + '(' + arg + ')';
              var convert = refs.add(conversion.convert, 'convert') + '(' + arg + ')';

              code.push(prefix + 'if (' + test + ') { // type: ' + conversion.from + ', convert to ' + conversion.to);
              code = code.concat(childs[conversion.to].toCode(refs, args.concat(convert), prefix + '  '));
              code.push(prefix + '}');
            }
          });
    }
    
    return code.join('\n');
  };

  /**
   * The root node of a node tree is an arguments node, which does not
   * have a map with childs per type, but has an array with entries for each
   * supported argument count
   */ 
  function RootNode(name) {
    this.args = [];
  }
  
  /**
   * Returns a string with JavaScript code for this function
   * @param {Refs} refs     Object to store function references
   * @param {string} [name] Optional function name
   * @return {string} code
   */
  RootNode.prototype.toCode = function (refs, name) {
    var code = [];

    // we use a regular for loop: can't use .map as this.args can contain undefined entries
    var params = [];
    for (var i = 0; i < this.args.length; i++) {
      params[i] = 'arg' + i;
    }

    code.push('return function ' + (name || '') + '(' + params.join(', ') + ') {');
    
    var first = true;
    this.args.forEach(function (node, index, array) {
      // Note that some indexes can be undefined, but forEach skips undefined 
      //      values automatically so we don't have to check whether node !== undefined.
      var args = [];
      var prefix = '    ';
      var statement = first ? 'if' : 'else if';
      code.push('  ' + statement + ' (arguments.length === ' + index +  ') {');
      code = code.concat(node.toCode(refs, args, prefix));

      code.push('  }');
      
      first = false;
    });

    if (!first) {
      code.push('  else {');
      code.push('    throw new TypeError(\'Wrong number of arguments\');'); // TODO: output the allowed numbers
      code.push('  }');
    }
    code.push('  throw new TypeError(\'Wrong function signature\');');  // TODO: output the actual signature
    code.push('}');
    
    return code.join('\n');
  };
  
  /**
   * Split all raw signatures into an array with (splitted) Signatures
   * @param {Object.<string, function>} rawSignatures
   * @return {Signature[]} Returns an array with splitted signatures
   */
  function splitSignatures(rawSignatures) {
    return Object.keys(rawSignatures).reduce(function (signatures, params) {
      var fn = rawSignatures[params];
      var signature = new Signature(params, fn);

      return signatures.concat(signature.split());
    }, []);
  }

  /**
   * create a map with normalized signatures as key and the function as value
   * @param {Signature[]} signatures   An array with splitted signatures
   * @return {Object} Returns a map with normalized signatures
   */
  function normalizeSignatures(signatures) {
    var normalized = {};

    signatures.map(function (entry) {
      var signature = entry.params.join(',');
      if (signature in normalized) {
        throw new Error('Error: signature "' + signature + '" defined twice');
      }
      normalized[signature] = entry.fn;
    });

    return normalized;
  }

  /**
   * Create a recursive node tree for traversing the number and type of parameters
   * @param {Array.<Signature>} signatures   An array with splitted signatures
   * @returns {RootNode} Returns a node tree
   */
  function createNodeTree(signatures) {
    var root = new RootNode();

    signatures.forEach(function (signature) {
      var params = signature.params.concat([]);
      
      // get the tree entry for the current number of arguments
      var argCount = params.length;
      var node = root.args[argCount];
      if (!node) {
        node = root.args[argCount] = new Node();
      }

      // loop over all parameters, create a nested structure
      while(params.length > 0) {
        var param = params.shift();
        var type = param.types[0];

        var child = node.childs[type];
        if (child === undefined) {
          child = node.childs[type] = new Node(node.signature.concat(type));
        }
        node = child;
      }

      // add the function as leaf of the innermost node
      node.fn = signature.fn;
    });

    return root;
  }

  /**
   * Compose a function from sub-functions each handling a single type signature.
   * Signatures:
   *   typed(signature: string, fn: function)
   *   typed(name: string, signature: string, fn: function)
   *   typed(signatures: Object.<string, function>)
   *   typed(name: string, signatures: Object.<string, function>)
   *
   * @param {string | null} name
   * @param {Object.<string, function>} signatures
   * @return {function} Returns the typed function
   * @private
   */
  function _typed(name, signatures) {
    var refs = new Refs();

    // parse signatures, create a node tree
    var structure = splitSignatures(signatures);
    var tree = createNodeTree(structure);
    
    var treeCode = tree.toCode(refs, name); // TODO: do not create references in toCode but in createNodeTree
    var refsCode = refs.toCode();

    // generate JavaScript code
    var factory = [
      '(function (' + refs.name + ') {',
      refsCode,
      treeCode,
      '})'
    ].join('\n');

    // evaluate the JavaScript code and attach function references
    var fn = eval(factory)(refs);

    // attach the signatures with sub-functions to the constructed function
    fn.signatures = normalizeSignatures(structure); // normalized signatures

    return fn;
  }

  // data type tests
  var types = {
    'null':     function (x) {return x === null},
    'boolean':  function (x) {return typeof x === 'boolean'},
    'number':   function (x) {return typeof x === 'number'},
    'string':   function (x) {return typeof x === 'string'},
    'function': function (x) {return typeof x === 'function'},
    'Array':    function (x) {return Array.isArray(x)},
    'Date':     function (x) {return x instanceof Date},
    'RegExp':   function (x) {return x instanceof RegExp},
    'Object':   function (x) {return typeof x === 'object'}
  };

  // type conversions. Order is important
  var conversions = [];

  // temporary object for holding types and conversions, for constructing
  // the `typed` function itself
  // TODO: find a more elegant solution for this
  var typed = {
    types: types,
    conversions: conversions
  };

  /**
   * Construct the typed function itself with various signatures
   *
   * Signatures:
   *
   *   typed(signature: string, fn: function)
   *   typed(name: string, signature: string, fn: function)
   *   typed(signatures: Object.<string, function>)
   *   typed(name: string, signatures: Object.<string, function>)
   */
  typed = _typed('typed', {
    'Object': function (signatures) {
      return _typed(null, signatures);
    },
    'string, Object': _typed,
    'string, function': function (signature, fn) {
      var signatures = {};
      signatures[signature] = fn;
      return _typed(null, signatures);
    },
    'string, string, function': function(name, signature, fn) {
      var signatures = {};
      signatures[signature] = fn;
      return _typed(name, signatures);
    }
  });

  // attach types and conversions to the final `typed` function
  typed.types = types;
  typed.conversions = conversions;

  return typed;
}));

