'use strict';

const Atom = require('./lib/atom.js');
const IconRenderer = require('./lib/icon_renderer.js');
const PanelManager = require('./lib/panels/manager.js');
const Component = require('./lib/component.js');
const EventEmitter = require('events');

class BluespessClient extends EventEmitter {
	constructor(wsurl, resRoot = "") {
		super();
		if(!wsurl)
			wsurl = "ws" + window.location.origin.substring(4);
		this.resRoot = resRoot;
		this.wsurl = wsurl;
		this.atoms_by_netid = {};
		this.atoms = [];
		this.visible_tiles = new Set();
		this.dirty_atoms = [];
		this.eyes = {"":{x:0,y:0}};
		this.glide_size = 10;
		this.icon_meta_load_queue = {};
		this.icon_metas = {};
		this.components = {};
		this.panel_classes = {};
		this.server_time_to_client;
		this.importModule(require('./lib/lighting.js'));
	}

	login() {
		if(global.is_bs_editor_env)
			throw new Error("Client should not be started in editor mode");
		this.connection = new WebSocket(this.wsurl);
		this.panel_manager = new PanelManager(this);
		this.connection.addEventListener('message', this.handleSocketMessage.bind(this));
		this.connection.addEventListener('open', () => {this.connection.send(JSON.stringify({"login":"guest" + Math.floor(Math.random()*1000000)}));});
		requestAnimationFrame(this.anim_loop.bind(this)); // Start the rendering loop
		document.addEventListener('keydown', (e) => {if(e.target.localName != "input"&&this.connection)this.connection.send(JSON.stringify({"keydown":{which:e.which,id:e.target.id}}));});
		document.addEventListener('keyup', (e) => {if(e.target.localName != "input"&&this.connection)this.connection.send(JSON.stringify({"keyup":{which:e.which,id:e.target.id}}));});
		this.updateMapWindowSizes();
		window.addEventListener('resize', this.updateMapWindowSizes.bind(this));
		document.getElementById('mainlayer').addEventListener("mousedown", this.handle_mousedown.bind(this));
	}

	importModule(mod) {
		if(mod.components) {
			for(var componentName in mod.components) {
				if(mod.components.hasOwnProperty(componentName)) {
					if(this.components[componentName]) {
						throw new Error(`Component ${componentName} already exists!`);
					}
					if(mod.components[componentName].name != componentName)
						throw new Error(`Component name mismatch! Named ${componentName} in map and constructor is named ${mod.components[componentName].name}`);
					this.components[componentName] = mod.components[componentName];
				}
			}
		}
		if(mod.panel_classes) {
			for(var class_name in mod.panel_classes) {
				if(mod.panel_classes.hasOwnProperty(class_name)) {
					if(this.panel_classes[class_name]) {
						throw new Error(`Panel class ${class_name} already exists!`);
					}
					if(mod.panel_classes[class_name].name != class_name)
						throw new Error(`Panel class name mismatch! Named ${class_name} in map and constructor is named ${mod.panel_classes[class_name].name}`);
					this.panel_classes[class_name] = mod.panel_classes[class_name];
				}
			}
		}
		if(mod.now instanceof Function) {
			mod.now(this);
		}
	}

	handleSocketMessage(event) {
		var obj = JSON.parse(event.data);
		console.log(obj);
		if(obj.create_atoms) {
			for(let i = 0; i < obj.create_atoms.length; i++) {
				new Atom(this, obj.create_atoms[i]);
			}
		}
		if(obj.update_atoms) {
			for(let i = 0; i < obj.update_atoms.length; i++) {
				var inst = obj.update_atoms[i];
				let atom = this.atoms_by_netid[inst.network_id];
				if(!atom) continue;
				var oldx = atom.x;
				var oldy = atom.y;
				for(let key in inst) {
					if(!inst.hasOwnProperty(key))
						continue;
					if(key == "appearance" || key == "network_id" || key == "overlays" || key == "components") {
						continue;
					}
					atom[key] = inst[key];
				}
				if((oldx != atom.x || oldy != atom.y) && Math.abs(Math.max(atom.x-oldx,atom.y-oldy)) <= 1.00001) {
					atom.glide = {x:oldx-atom.x,y:oldy-atom.y,lasttime:performance.now()};
				}
				if(inst.overlays) {
					for(let key in inst.overlays) {
						if(!inst.overlays.hasOwnProperty(key))
							continue;
						atom.set_overlay(key, inst.overlays[key]);
					}
				}
				if(inst.components) {
					for(let component_name in inst.components) {
						if(!inst.components.hasOwnProperty(component_name))
							continue;
						for(let key in inst.components[component_name]) {
							if(!inst.components[component_name].hasOwnProperty(key))
								continue;
							atom.components[component_name][key] = inst.components[component_name][key];
						}
					}
				}
			}
		}
		if(obj.delete_atoms) {
			for(var i = 0; i < obj.delete_atoms.length; i++) {
				let atom = this.atoms_by_netid[obj.delete_atoms[i]];
				if(!atom) continue;
				atom.del();
			}
		}
		if(obj.timestamp) {
			this.server_time_to_client = performance.now() - obj.timestamp;
		}
		if(obj.add_tiles) {
			for(let tile of obj.add_tiles) {
				this.visible_tiles.add(tile);
			}
		}
		if(obj.remove_tiles) {
			for(let tile of obj.remove_tiles) {
				this.visible_tiles.delete(tile);
			}
		}
		if(obj.eye) {
			setTimeout(() => {
				this.eyes[""] = this.atoms_by_netid[obj.eye[""]];
			}, 500);
		}
		if(obj.to_chat) {
			for(let item of obj.to_chat) {
				let newdiv = document.createElement('div');
				newdiv.innerHTML = item;
				document.getElementById('chatwindow').appendChild(newdiv);
			}
		}
		if(obj.panel) {
			this.panel_manager.handle_message(obj.panel);
		}
		this.atoms.sort(Atom.atom_comparator);

		return obj;
	}

	updateMapWindowSizes() {
		var mapwindow_container = document.getElementById("mapwindow-container");
		var minsize = Math.min(mapwindow_container.clientWidth, mapwindow_container.clientHeight);
		document.getElementById('mapwindow').style.transform = `scale(${minsize/480})`;
	}

	get_mouse_target(e) {
		var clickX = e.offsetX;
		var clickY = e.offsetY;
		// Iterate through the atoms from top to bottom.
		var clickedAtom;
		for(var i = this.atoms.length-1; i >= 0; i--) {
			var atom = this.atoms[i];
			var {dispx, dispy} = atom.get_displacement(performance.now());
			var localX = (clickX - dispx)/32;
			var localY = 1-(clickY - dispy)/32;
			var bounds = atom.get_bounds();
			if(bounds && localX >= bounds.x && localX < bounds.width && localY >= bounds.y && localY < bounds.height && atom.is_mouse_over(localX, localY, performance.now())) {
				clickedAtom = atom;
				break;
			}
		}
		if(!clickedAtom)
			return;
		return {"atom":clickedAtom,"x":localX,"y":localY, "ctrlKey": e.ctrlKey, "shiftKey": e.shiftKey, "altKey": e.altKey, "button": e.button};
	}

	handle_mousedown(e) {
		var start_meta = this.get_mouse_target(e);
		var start_time = performance.now();
		var mouseup = (e2) => {
			if(e2.button != e.button)
				return;
			document.removeEventListener("mouseup", mouseup);
			var end_time = performance.now();
			var end_meta = this.get_mouse_target(e2);
			console.log(end_time - start_time);
			if(end_time - start_time < 200 || end_meta.atom == start_meta.atom) {
				if(this.connection)
					this.connection.send(JSON.stringify({"click_on":Object.assign({}, start_meta, {atom: start_meta.atom.network_id})}));
				return;
			}
			this.connection.send(JSON.stringify({
				"drag": {
					from: Object.assign({}, start_meta, {atom: start_meta.atom.network_id}),
					to: Object.assign({}, end_meta, {atom: end_meta.atom.network_id})
				}
			}));
		};
		document.addEventListener("mouseup", mouseup);
	}
}

// This is pretty much identical to the function on the server's lib/utils.js
BluespessClient.chain_func = function(func1, func2) {
	if(func2 == undefined)
		throw new Error('Chaining undefined function!');
	return function chained_func(...args) {
		return func2.call(this, (...override_args)=>{
			if(!func1)
				return;
			if(override_args.length)
				return func1.call(this, ...override_args);
			else
				return func1.call(this, ...args);
		}, ...args);
	};
};

BluespessClient.prototype.enqueue_icon_meta_load = require('./lib/icon_loader.js');
BluespessClient.prototype.anim_loop = require('./lib/renderer.js');

BluespessClient.Atom = Atom;
BluespessClient.Component = Component;
BluespessClient.IconRenderer = IconRenderer;

module.exports = BluespessClient;
