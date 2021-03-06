'use strict';

const {Component, Atom} = require('../server.js');

const _on = Symbol('_on');
const _color = Symbol('_color');
const _radius = Symbol('_radius');
const _lighting_object = Symbol('_lighting_object');

class LightingObject extends Component.Networked {
	constructor(atom, template) {
		super(atom, template);

		this.add_networked_var("on");
		this.add_networked_var("color");
		this.add_networked_var("radius", this.change_radius.bind(this));
		this.add_networked_var("shadows_list");
		this.shadows = new Map();
		this.move_callbacks = new Map();
		this.a.on("crossed", this.crossed.bind(this));
		this.a.on("crossed_by", this.crossed.bind(this));
		this.a.on("uncrossed", this.uncrossed.bind(this));
		this.a.on("uncrossed_by", this.uncrossed.bind(this));
		this.change_radius(this.radius);
		this.update_shadows_string();
	}

	crossed(item) {
		if(!item.opacity)
			return;
		if(this.shadows.has(item))
			return;
		var move_callback = this.update_shadow.bind(this, item);
		this.move_callbacks.set(item, move_callback);
		item.on("moved", move_callback);
		var shadow = {};
		shadow.x1 = item.x + item.bounds_x;
		shadow.y1 = item.y + item.bounds_y;
		shadow.x2 = item.x + item.bounds_x + item.bounds_width;
		shadow.y2 = item.y + item.bounds_y + item.bounds_height;
		this.shadows.set(item, shadow);
		this.update_shadows_string();
	}

	uncrossed(item) {
		if(!this.shadows.has(item))
			return;
		var move_callback = this.move_callbacks.get(item);
		if(move_callback) {
			item.removeListener("moved", move_callback);
		}
		this.shadows.delete(item);
		this.update_shadows_string();
	}

	update_shadow(item) {
		if(!item.opacity)
			return this.uncrossed(item);
		var shadow = this.shadows.get(item);
		if(!shadow)
			return this.crossed(item);
		shadow.x1 = item.x + item.bounds_x;
		shadow.y1 = item.y + item.bounds_y;
		shadow.x2 = item.x + item.bounds_x + item.bounds_width;
		shadow.y2 = item.y + item.bounds_y + item.bounds_height;
		this.update_shadows_string();
	}

	update_shadows_string() {
		this.shadows_list = Array.from(this.shadows.values());
	}

	change_radius(newval) {
		if(newval === +newval) {
			this.a.bounds_x = -newval;
			this.a.bounds_y = -newval;
			this.a.bounds_width = newval*2+1;
			this.a.bounds_height = newval*2+1;
		} else {
			this.a.bounds_width = 1;
			this.a.bounds_height = 1;
			this.a.bounds_x = 0;
			this.a.bounds_y = 0;
		}
		return true;
	}
}

class LightSource extends Component {
	constructor(atom, template) {
		super(atom, template);
		this[_lighting_object] = new Atom(this.a.server, {components:["LightingObject"]});
		this.update_lighting_object();
		this.a.on("moved", this.update_lighting_object.bind(this));
		this.a.on("parent_moved", this.update_lighting_object.bind(this));
	}
	update_lighting_object() {
		if(!this[_lighting_object])
			return;
		if(!this[_on] || !this.a.loc || (!this.a.loc.is_base_loc && (!this.a.loc.loc || !this.a.loc.loc.is_base_loc))) {
			this[_lighting_object].loc = null;
			this[_lighting_object].c.LightingObject.on = false;
			return;
		}
		this[_lighting_object].glide_size = this.a.base_mover.glide_size;
		this[_lighting_object].x = this.a.x;
		this[_lighting_object].y = this.a.y;
		this[_lighting_object].z = this.a.z;
		this[_lighting_object].c.LightingObject.on = true;
		this[_lighting_object].c.LightingObject.color = this[_color];
		this[_lighting_object].c.LightingObject.radius = this[_radius];
	}
	get on() {return this[_on];}
	set on(val) {
		this[_on] = val;
		this.update_lighting_object();
	}

	get color() {return this[_color];}
	set color(val) {
		this[_color] = val;
		this.update_lighting_object();
	}

	get radius() {return this[_radius];}
	set radius(val) {
		this[_radius] = val;
		this.update_lighting_object();
	}
}

LightSource.template = {
	vars: {
		components: {
			"LightSource": {
				on: false,
				radius: 2,
				color: "#ffffff"
			}
		}
	}
};

class LightingTile extends Component.Networked {
	constructor(atom, template) {
		super(atom, template);
	}
}

module.exports.components = {LightingObject, LightingTile, LightSource};
