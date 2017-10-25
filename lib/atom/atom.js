'use strict';
const EventEmitter = require('events');
const mob_symbols = require('./mob.js')._symbols;
const {readonlyTraps} = require('../utils.js');

var id_counter = 0;

const _loc = Symbol('_loc');
const _x = Symbol('_x');
const _y = Symbol('_y');
const _z = Symbol('_z');
const _bounds_x = Symbol('_bounds_x');
const _bounds_y = Symbol('_bounds_y');
const _bounds_width = Symbol('_bounds_width');
const _bounds_height = Symbol('_bounds_height');
const _crosses = Symbol('_crosses');

const _changeloc = Symbol('_changeloc');

class Atom extends EventEmitter {
	constructor(server, template, x, y, z) {
		if(!server || !template)
			throw 'Invalid arguments while instantiating ';
		super();
		this.template = template;

		Object.defineProperty(this, 'server', {enumerable: false,configurable: false,writable: false,value: server});
		Object.defineProperty(this, 'object_id', {enumerable: true,configurable: false,writable: false,value: `ID_${id_counter++}`});
		Object.defineProperty(this, 'contents', {enumerable: true,configurable: false,writable: false,value: []});

		this[_crosses] = [];
		this.crosses = new Proxy(this[_crosses], readonlyTraps);

		this.server.process_template(template);
		server.atoms[this.object_id] = this;

		this[_bounds_x] = 0;
		this[_bounds_y] = 0;
		this[_bounds_width] = 1;
		this[_bounds_height] = 1;
		this[mob_symbols._viewers] = [];

		if(typeof x === "number") {
			x = +x;
			y = +y;
			z = +z;
			if(x !== x) x = 0;
			if(y !== y) y = 0;
			if(z !== z) z = 0;
			z = Math.floor(z);

			this[_changeloc](x, y, z, this.server.location(x,y,z));
		} else if(typeof x === "object" && x !== null) {
			if(x.isBaseLoc) {
				this[_changeloc](x.x, x.y, x.z, x);
			} else {
				this[_changeloc](0, 0, 0, x);
			}
		} else {
			this[_changeloc](0, 0, 0, null);
		}

		this.appearance = new Proxy(Object.assign({layer: 0}, template && template.vars && template.vars.appearance ? template.vars.appearance : {}), {
			set: (target, key, value) => {
				target[key] = value;
				this[mob_symbols._update_var](key, 1);
				return true;
			}, deleteProperty: (target, key) => {
				this.appearance[key] = undefined;
				delete target[key];
				return true;
			}
		});

		this.overlays = new Proxy({}, {
			set: (target, key, value) => {
				if(value === undefined || value === null) {
					target[key] = undefined;
					this[mob_symbols._update_var](key, 2);
					return true;
				}
				if((typeof value) == "string")
					value = {"icon_state": value, "overlay_layer": 1};
				if(value instanceof Atom)
					value = value.appearance;
				if(typeof value != "object")
					throw new TypeError(`Object or string expected for overlay. Got ${value} instead.`);
				value = new Proxy(Object.assign({}, value), {
					set: (target2, key2, value2) => {
						target2[key2] = value2;
						this[mob_symbols._update_var](key, 2);
					}
				});
				target[key] = value;
				this[mob_symbols._update_var](key, 2);
				return true;
			}
		});

		this.components = {};
		if(template.components) {
			for(let i = 0; i < template.components.length; i++) {
				let componentName = template.components[i];
				if(this.components[componentName])
					throw new Error(`Template '${template.id}' defines component '${componentName}' multiple times`);
				let componentConstructor = this.server.components[componentName];
				if(!componentConstructor)
					throw new Error(`Template '${template.id}' references non-existent component '${componentName}'`);
				let templateVars = template.vars && template.vars.components && template.vars.components[componentName] ? template.vars.components[componentName] : {};
				this.components[componentName] = new this.server.components[componentName](this, templateVars);
			}
		}
	}

	[_changeloc](newX, newY, newZ, newLoc, newBounds_x, newBounds_y, newBounds_width, newBounds_height) {
		// Test for cycles, but don't bother if the new location is in the world
		if (newLoc && !newLoc.isBaseLoc) {
			let slowPointer = newLoc;
			let fastPointer = newLoc;
			while(fastPointer != null) {
				slowPointer = slowPointer.loc;
				fastPointer = fastPointer.loc;
				if(fastPointer)
					fastPointer = fastPointer.loc;
				if(fastPointer == slowPointer || fastPointer == this || slowPointer == this)
					throw new Error(`Cycle detected when assigning the location of ${this} to ${newLoc}`);
			}
		}

		var lostViewers = [];
		var gainedViewers = [];

		var lostCrossers = [];
		var gainedCrossers = [];

		if(this[_loc]) {
			if(this[_loc].contents) {
				let idx = this[_loc].contents.indexOf(this);
				if(idx != -1)
					this[_loc].contents.splice(idx, 1);
			}
			if(this[_loc].isBaseLoc) {
				for(let x = Math.floor(this[_x]+this[_bounds_x]+0.00001); x <= Math.ceil(this[_x]+this[_bounds_x]+this[_bounds_width]-0.00001); x++) {
					for(let y = Math.floor(this[_y]+this[_bounds_y]+0.00001); y <= Math.ceil(this[_y]+this[_bounds_y]+this[_bounds_height]-0.00001); y++) {
						let thisloc = this.server.location(x,y,this[_z]);
						let idx = thisloc.partial_contents.indexOf(this);
						if(idx != -1)
							thisloc.partial_contents.splice(idx, 1);
						thisloc.viewers.forEach((item) => {lostViewers.push(item);});
						for(let atom of thisloc.partial_contents) {
							if(atom != this && atom.does_cross(this)) {
								if(lostCrossers.indexOf(atom) == -1)
									this.lostCrossers.push(atom);
							}
						}
					}
				}
			}
		}

		this[_x] = newX;
		this[_y] = newY;
		this[_z] = newZ;
		this[_loc] = newLoc;
		if(newBounds_x !== undefined) {
			this[_bounds_x] = newBounds_x;
			this[_bounds_y] = newBounds_y;
			this[_bounds_width] = newBounds_width;
			this[_bounds_height] = newBounds_height;
		}

		this[_crosses].length = 0;

		if(this[_loc]) {
			if(this[_loc].contents) {
				this[_loc].contents.push(this);
			}
			if(this[_loc].isBaseLoc) {
				for(let x = Math.floor(this[_x]+this[_bounds_x]+0.00001); x <= Math.ceil(this[_x]+this[_bounds_x]+this[_bounds_width]-0.00001); x++) {
					for(let y = Math.floor(this[_y]+this[_bounds_y]+0.00001); y <= Math.ceil(this[_y]+this[_bounds_y]+this[_bounds_height]-0.00001); y++) {
						let thisloc = this.server.location(x,y,this[_z]);
						thisloc.partial_contents.push(this);
						thisloc.viewers.forEach((item) => {gainedViewers.push(item);});
						for(let atom of thisloc.partial_contents) {
							if(atom != this && this.does_cross(atom)) {
								var idx = lostCrossers.indexOf(atom);
								if(idx != -1) {
									if(gainedCrossers.indexOf(atom) == -1)
										this.gainedCrossers.push(atom);
								} else {
									lostCrossers.splice();
								}
							}
						}
					}
				}

			}
		}

		for(let lost of lostViewers) {
			if(!lost.components.Eye.can_see(this))
				lost.components.Eye[mob_symbols._remove_viewing](this);
		}
		for(let gained of gainedViewers) {
			if(gained.components.Eye.can_see(this))
				gained.components.Eye[mob_symbols._add_viewing](this);
		}

		this.emit("moved");
		this[mob_symbols._update_var]('x', 0); // Send the changes to the network.
		this[mob_symbols._update_var]('y', 0);
	}

	get x() {
		if(this[_loc] && !this[_loc].isBaseLoc)
			return this[_loc].x;
		return this[_x];
	}
	set x(newX) {
		newX = +newX; // cast to number
		if(newX === this[_x] && this[_loc].isBaseLoc)
			return;
		if(newX !== newX) // NaN check, NaN != NaN
			throw new TypeError(`New X value ${newX} is not a number!`);
		this[_changeloc](newX, this[_y], this[_z], this.server.location(newX,this[_y],this[_z]));
	}

	get y() {
		if(this[_loc] && !this[_loc].isBaseLoc)
			return this[_loc].x;
		return this[_y];
	}
	set y (newY) {
		newY = +newY; // cast to number
		if(newY === this[_y] && this[_loc].isBaseLoc)
			return;
		if(newY !== newY) // NaN check, NaN != NaN
			throw new TypeError(`New Y value ${newY} is not a number!`);
		this[_changeloc](this[_x], newY, this[_z], this.server.location(this[_x],newY,this[_z]));
	}

	get z() {
		if(this[_loc] && !this[_loc].isBaseLoc)
			return this[_loc].x;
		return this[_z];
	}
	set z(newZ) {
		newZ = +newZ; // ast to number
		if(newZ === this[_z] && this[_loc].isBaseLoc)
			return;
		if(newZ === newZ) // NaN check, NaN != NaN
			throw new TypeError(`New Z value ${newZ} is not a number!`);
		this[_loc] = this.server.location(this[_x],this[_y],this[_z]);
		this[_changeloc](this[_x], this[_y], newZ, this.server.location(this[_x],this[_y],newZ));
	}

	get loc() {
		return this[_loc];
	}
	set loc(newLoc){
		if(newLoc === this[_loc])
			return;
		if(newLoc !== null && (typeof newLoc !== "object" || typeof newLoc.contents !== "object" || newLoc.contents === null || newLoc.contents.constructor.name != "Array"))
			throw new TypeError('New loc is not a valid location (not an object or missing a contents list)');
		if(newLoc !== null && newLoc.isBaseLoc) {
			this[_changeloc](newLoc.x,newLoc.y,newLoc.z,newLoc);
		} else {
			this[_changeloc](0, 0, 0, newLoc);
		}
	}

	get base_loc() {
		var a = this;
		while(a && !a.isBaseLoc)
			a = a.loc;
		return a;
	}

	get bounds_x() {
		return this[_bounds_x];
	}
	set bounds_x(newval) {
		newval = +newval;
		if(newval == this[_bounds_x])
			return;
		if(newval != newval)
			throw new TypeError(`New boundary ${newval} is not a number`);
		this[_changeloc](this[_x], this[_y], this[_z], this[_loc], newval, this[_bounds_y], this[_bounds_width], this[_bounds_height]);
	}

	get bounds_y(){
		return this[_bounds_y];
	}
	set bounds_y(newval) {
		newval = +newval;
		if(newval == this[_bounds_y])
			return;
		if(newval != newval)
			throw new TypeError(`New boundary ${newval} is not a number`);
		this[_changeloc](this[_x], this[_y], this[_z], this[_loc], this[_bounds_x], newval, this[_bounds_width], this[_bounds_height]);
	}

	get bounds_width(){
		return this[_bounds_width];
	}
	set bounds_width(newval) {
		newval = +newval;
		if(newval == this[_bounds_width])
			return;
		if(newval != newval)
			throw new TypeError(`New boundary ${newval} is not a number`);
		this[_changeloc](this[_x], this[_y], this[_z], this[_loc], this[_bounds_x], this[_bounds_y], newval, this[_bounds_height]);
	}

	get bounds_height() {
		return this[_bounds_height];
	}
	set bounds_height(newval) {
		newval = +newval;
		if(newval == this[_bounds_height])
			return;
		if(newval != newval)
			throw new TypeError(`New boundary ${newval} is not a number`);
		this[_changeloc](this[_x], this[_y], this[_z], this[_loc], this[_bounds_x], this[_bounds_y], this[_bounds_width], newval);
	}

	move(offsetx, offsety) {
		this.x += offsetx;
		this.y += offsety;
	}

	// Checks if this thing encloses the tile.
	does_enclose_tile(tile) {
		if(!tile.isBaseLoc || !this.loc || !this.loc.isBaseLoc || this.z != tile.z)
			return false;
		return (this.x + this.bounds_x - 0.00001 <= tile.x &&
			this.y + this.bounds_y - 0.00001 <= tile.y &&
			this.x + this.bounds_x + this.bounds_width + 0.00001 >= tile.x + 1 &&
			this.y + this.bounds_y + this.bounds_height + 0.00001 >= tile.y + 1);
	}

	does_cross(atom) {
		if(!(atom instanceof Atom) || atom.z != this.z || !this.loc || !atom.loc || !this.loc.isBaseLoc || !atom.loc.isBaseLoc)
			return (this.x + this.bounds_x + this.bounds_width - 0.00001) > (atom.x + atom.bounds_x)
				&& (this.x + this.bounds_x + 0.00001) < (atom.x + atom.bounds_x + atom.bounds_width)
				&& (this.y + this.bounds_y + this.bounds_height - 0.00001) > (atom.y + atom.bounds_y)
				&& (this.y + this.bounds_y + 0.00001) < (atom.y + atom.bounds_y + atom.bounds_height);
	}

	[Symbol.iterator]() {
		return this.contents[Symbol.iterator]();
	}
	[mob_symbols._update_var](varname, type) {
		for(let viewer of this[mob_symbols._viewers]) {
			viewer.components.Eye.enqueue_update_atom_var(viewer.components.Eye[mob_symbols._server_to_net][this.object_id], this, varname, type);
		}
	}
}

module.exports = Atom;