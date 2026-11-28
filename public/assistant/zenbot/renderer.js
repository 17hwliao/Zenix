(() => {
  const expressions = ['neutral', 'happy', 'wink', 'love', 'shy', 'surprised', 'angry', 'sad', 'sleepy', 'thinking', 'smug', 'pout', 'worried', 'determined', 'flustered', 'scared', 'excited', 'cry', 'confused'];
  const motions = ['stand', 'jump', 'hop', 'look', 'turn', 'nod', 'shake', 'spin', 'sit', 'sleep', 'dizzy', 'walk', 'run', 'wave', 'bow', 'shiver', 'flap', 'dance'];
  const states = {idle: ['neutral', 'stand'], listening: ['neutral', 'look'], thinking: ['thinking', 'look'], executing: ['determined', 'nod'], success: ['happy', 'jump'], failure: ['worried', 'shake'], shy: ['shy', 'bow'], greeting: ['happy', 'wave'], cheer: ['excited', 'dance'], talking: ['happy', 'stand'], dragged: ['scared', 'shiver'], falling: ['surprised', 'stand'], landed: ['happy', 'hop'], tap: ['shy', 'nod'], pet: ['love', 'look'], sleep: ['sleepy', 'sleep'], sit: ['happy', 'sit'], wave: ['happy', 'wave']};
  const cache = new Map();
  const spriteFeet = new WeakMap();

  function spriteFoot(image) {
    if (!spriteFeet.has(image)) {
      const canvas = document.createElement('canvas');canvas.width = image.width;canvas.height = image.height;
      const context = canvas.getContext('2d');context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let foot = canvas.height;
      outer: for (let y = canvas.height - 1; y >= 0; y--) for (let x = 0; x < canvas.width; x++) if (pixels[(y * canvas.width + x) * 4 + 3] > 24) {foot = y + 1;break outer;}
      spriteFeet.set(image, foot);
    }
    return spriteFeet.get(image);
  }

  function image(url) {
    if (!cache.has(url)) cache.set(url, new Promise((resolve, reject) => {
      const value = new Image();
      value.onload = () => resolve(value);
      value.onerror = () => {cache.delete(url); reject(Error('Zenbot 素材无法读取'));};
      value.src = url;
    }));
    return cache.get(url);
  }

  function pose(motion, seconds) {
    const wave = Math.sin(seconds * 3), fast = Math.sin(seconds * 9);
    const value = {root: {y: -Math.sin(seconds * 1.5) * 1.3}, chest: {rotation: wave * .5}, hair_back: {rotation: wave * .8}};
    switch (motion) {
      case 'jump': case 'hop': value.root.y -= Math.max(0, Math.sin(seconds * 5)) * (motion === 'jump' ? 18 : 9); break;
      case 'look': value.head = {rotation: Math.sin(seconds * 1.8) * 3}; break;
      case 'turn': value.root.rotation = Math.sin(seconds * 4) * 7; break;
      case 'nod': value.head = {rotation: Math.max(0, fast) * 7}; break;
      case 'shake': value.head = {rotation: fast * 7}; break;
      case 'spin': value.root.rotation = seconds % 1.2 / 1.2 * 360; break;
      case 'sit': value.root.y += 20; value.leg_l = {rotation: -30}; value.leg_r = {rotation: 30}; break;
      case 'sleep': value.root.rotation = 12; value.head = {rotation: 14}; break;
      case 'dizzy': value.root.rotation = wave * 10; value.head = {rotation: -wave * 10}; break;
      case 'walk': case 'run': {
        const stride = Math.sin(seconds * (motion === 'run' ? 12 : 7));
        value.leg_l = {rotation: stride * 13}; value.leg_r = {rotation: -stride * 13};
        value.arm_l = {rotation: -stride * 8}; value.arm_r = {rotation: stride * 8};
        value.root.y -= Math.abs(stride) * 3;
        break;
      }
      case 'wave': value.arm_r = {rotation: -65 + fast * 14}; break;
      case 'bow': value.body = {rotation: Math.max(0, wave) * 14}; value.head = {rotation: Math.max(0, wave) * 9}; break;
      case 'shiver': value.root.x = Math.sin(seconds * 35) * 2; break;
      case 'flap': value.arm_l = {rotation: 30 + fast * 20}; value.arm_r = {rotation: -30 - fast * 20}; break;
      case 'dance': value.root.rotation = wave * 5; value.arm_l = {rotation: 20 + fast * 12}; value.arm_r = {rotation: -20 - fast * 12}; value.skirt = {rotation: wave * 4}; break;
    }
    return value;
  }

  class ZenbotRenderer {
    constructor(canvas, base, options = {}) {
      this.canvas = canvas;
      canvas.dataset.figure = options.figure || 'zenbot';
      this.base = base;
      this.options = options;
      this.images = new Map();
      this.started = performance.now();
      this.state = 'idle';
      this.disposed = false;
      this.context = canvas.getContext('2d');
      this.reduced = matchMedia('(prefers-reduced-motion:reduce)');
      this.visibility = () => {cancelAnimationFrame(this.frame); this.draw();};
      this.media = () => this.visibility();
      document.addEventListener('visibilitychange', this.visibility);
      this.reduced.addEventListener('change', this.media);
      this.resizeObserver = new ResizeObserver(() => this.visibility());
      this.resizeObserver.observe(canvas);
      this.ready = this.load();
    }

    async load() {
      try {
        if (this.options.figure === 'whale') {await this.loadWhale();this.loaded = true;if (!this.disposed) this.draw();return;}
        const response = await fetch(this.base + '/rig/manifest.json');
        if (!response.ok) throw Error('manifest');
        this.manifest = await response.json();
        if (this.manifest.parts.length !== 18) throw Error('parts');
        await Promise.all(this.manifest.parts.map(async part => this.images.set(part.id, await image(this.base + '/rig/' + part.file))));
        await this.face('neutral');
      } catch {this.fallback = await image(this.base + (this.options.figure === 'whale' ? '/thumbs/deepseek.png' : '/expressions/neutral.png')); this.options.onFallback?.();}
      this.loaded = true;
      if (!this.disposed) {
        if (this.fallback) this.setState(this.state, this.options);
        else this.draw();
      }
    }

    async face(expression) {
      if (this.options.figure === 'whale') return;
      const texture = await image(this.base + '/rig/expressions/' + expression + '.png');
      if (!this.disposed) this.images.set('expression:' + expression, texture);
    }

    setState(state, settings = {}) {
      if (this.state !== state || settings.motion !== this.options.motion) this.started = performance.now();
      this.state = state;
      this.options = {...this.options, ...settings};
      if (this.fallback && this.options.figure !== 'whale') {
        const motion = motions.includes(this.options.motion) ? this.options.motion : (states[this.state] || states.idle)[1];
        const file = motion !== 'stand' ? '/motions/' + motion + '.png' : '/expressions/' + this.expression() + '.png';
        void image(this.base + file).then(value => {if (!this.disposed) {this.fallback = value;this.visibility();}}).catch(() => {});
        this.visibility();
        return;
      }
      const expression = this.expression();
      void this.face(expression).then(() => {if (!this.disposed) this.visibility();}).catch(() => {});
      if (!this.disposed && (this.manifest || this.fallback)) this.visibility();
    }

    expression() {return expressions.includes(this.options.expression) ? this.options.expression : (states[this.state] || states.idle)[0];}

    draw() {
      if (this.disposed || !this.context || !this.loaded) return;
      cancelAnimationFrame(this.frame);
      const context = this.context;
      const pixelRatio = Math.min(2, devicePixelRatio || 1);
      // Rasterize in layout coordinates. Transformed visual bounds (hover,
      // lifted/dragged rotation or preview scaling) must never feed bitmap size
      // back into the character's own geometry.
      const bounds = {width: this.canvas.clientWidth, height: this.canvas.clientHeight};
      if (!bounds.width || !bounds.height) return;
      const width = Math.round(bounds.width * pixelRatio), height = Math.round(bounds.height * pixelRatio);
      if (this.canvas.width !== width) this.canvas.width = width;
      if (this.canvas.height !== height) this.canvas.height = height;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, bounds.width, bounds.height);
      if (this.options.direction === -1) {context.translate(bounds.width, 0);context.scale(-1, 1);}
      if (this.fallback) {
        const scale = Math.min(bounds.width / this.fallback.width, bounds.height / this.fallback.height);
        const animated = !document.hidden && !this.reduced.matches && this.options.animated !== false;
        const seconds = animated ? (performance.now() - this.started) / 1000 : 0;
        const motion = motions.includes(this.options.motion) ? this.options.motion : (states[this.state] || states.idle)[1];
        const transform = pose(motion, seconds);
        const centerY = this.options.groundAligned ? bounds.height - (spriteFoot(this.fallback) - this.fallback.height / 2) * scale : bounds.height / 2;
        context.translate(bounds.width / 2 + (transform.root.x || 0), centerY + (transform.root.y || 0));
        context.rotate(((transform.root.rotation || 0) + (transform.head?.rotation || 0) * .3) * Math.PI / 180);
        context.drawImage(this.fallback, -this.fallback.width * scale / 2, -this.fallback.height * scale / 2, this.fallback.width * scale, this.fallback.height * scale);
        this.canvas.dataset.renderer = 'sprite';
        if (animated) this.frame = requestAnimationFrame(() => this.draw());
        return;
      }
      if (!this.manifest) return;
      this.canvas.dataset.renderer = 'rig';
      const animated = !document.hidden && !this.reduced.matches && this.options.animated !== false;
      const seconds = animated ? (performance.now() - this.started) / 1000 : 0;
      const motion = motions.includes(this.options.motion) ? this.options.motion : (states[this.state] || states.idle)[1];
      const transforms = pose(motion, seconds);
      if (this.options.figure === 'whale') this.paintWhaleFace(seconds);
      if (this.state === 'dragged') transforms.root.rotation = this.options.tilt || 0;
      const gaze = this.options.gaze || {x: 0, y: 0};
      transforms.head = {...transforms.head, rotation: (transforms.head?.rotation || 0) + Math.max(-3, Math.min(3, gaze.x * 3))};
      const view = this.manifest.drawing.view;
      const viewWidth = view[2] - view[0], viewHeight = view[3] - view[1];
      const scale = Math.min(bounds.width / viewWidth, bounds.height / viewHeight);
      // Only the in-application companion opts into a floor anchor. Portraits
      // and settings previews keep their centered composition and full view.
      const originY = this.options.groundAligned ? bounds.height - this.manifest.drawing.feetY * scale : (bounds.height - viewHeight * scale) / 2 - view[1] * scale;
      context.translate((bounds.width - viewWidth * scale) / 2 - view[0] * scale, originY);
      context.scale(scale, scale);
      const transform = id => {
        const deformer = this.manifest.deformers[id];
        if (!deformer) return;
        if (deformer.parent) transform(deformer.parent);
        const value = transforms[id] || {};
        context.translate(deformer.pivot[0] + (value.x || 0), deformer.pivot[1] + (value.y || 0));
        context.rotate((value.rotation || 0) * Math.PI / 180);
        context.translate(-deformer.pivot[0], -deformer.pivot[1]);
      };
      for (const part of [...this.manifest.parts].sort((left, right) => left.z - right.z)) {
        context.save();
        transform(part.parent);
        const texture = part.id === 'face_base' ? this.images.get('expression:' + this.expression()) || this.images.get(part.id) : this.images.get(part.id);
        if (this.options.figure === 'whale' && (part.id.includes('_sit') !== (motion === 'sit') && (part.id.includes('_sit') || ['skirt','waist_bow_front'].includes(part.id)))) {context.restore();continue;}
        context.globalAlpha = part.alpha;
        context.drawImage(texture, ...part.box);
        if (part.id === 'face_base' && this.state === 'talking' && animated) {
          context.fillStyle = '#60454d';
          context.beginPath(); context.ellipse(140, 73, 2, 1 + Math.abs(Math.sin(seconds * 12)) * 2, 0, 0, Math.PI * 2); context.fill();
        }
        context.restore();
      }
      if (animated) this.frame = requestAnimationFrame(() => this.draw());
    }

    async loadWhale() {
      const response = await fetch(this.base + '/model.json');
      if (!response.ok) throw Error('whale model');
      const model = await response.json();
      this.whale = model;
      const pivots = model.pivots;
      const deformers = {root: {pivot: pivots.body}, body: {parent: 'root', pivot: pivots.waist}, chest: {parent: 'body', pivot: pivots.neck}, head: {parent: 'chest', pivot: pivots.head}, hair_back: {parent: 'head', pivot: pivots.neck}, arm_l: {parent: 'chest', pivot: pivots.armNear}, arm_r: {parent: 'chest', pivot: pivots.armFar}, leg_l: {parent: 'root', pivot: pivots.legBack}, leg_r: {parent: 'root', pivot: pivots.legFront}, skirt: {parent: 'root', pivot: pivots.waist}};
      const parents = {hairSway: 'hair_back', tailBend: 'root', armNear: 'arm_l', armFar: 'arm_r', legBack: 'leg_l', legFront: 'leg_r', skirt: 'skirt', skirtSit: 'skirt', body: 'chest', bangsSway: 'head', headMid: 'head', headFeat: 'head', finNear: 'head', finFar: 'head', ahoge: 'head'};
      const parts = model.parts.map(part => ({...part, parent: parents[part.parent] || 'root', alpha: 1}));
      await Promise.all(parts.map(async part => this.images.set(part.id, await image(this.base + '/tex/' + part.tex + '.png'))));
      const features = [...Object.keys(model.feat.sprites), ...['eyeL','eyeR'].flatMap(eye => ['lash','ball','iris','hl'].map(layer => eye + '_' + layer))];
      await Promise.all(features.map(async name => this.images.set(name, await image(this.base + '/feat/' + name + '.png'))));
      const face = document.createElement('canvas');face.width = 390;face.height = 252;
      this.images.set('faceFx', face);
      parts.push({id: 'faceFx', parent: 'head', box: [103.3,106.85,74.1,47.88], alpha: 1,z: 9});
      this.manifest = {parts, deformers, drawing: {view: [-12, -8, 268, 264], feetY: pivots.body[1]}};
    }

    paintWhaleFace(seconds) {
      const canvas = this.images.get('faceFx'), context = canvas.getContext('2d'), features = this.whale.feat;
      context.clearRect(0,0,390,252);
      const expression = this.expression();
      const mood = ['happy','love','surprised'].includes(expression) ? expression : expression === 'scared' ? 'drag' : expression === 'sleepy' ? 'sleep' : expression === 'confused' ? 'dizzy' : 'neutral';
      const draw = (name, rectangle, x = 0, y = 0) => {const texture = this.images.get(name);if (texture) context.drawImage(texture,rectangle[0]-520+x,rectangle[1]-578+y,rectangle[2]-rectangle[0],rectangle[3]-rectangle[1]);};
      const blink = seconds % 5.5 > 5.3;
      for (const eye of ['eyeL','eyeR']) {
        const sprite = (blink ? 'sleep' : mood) + '_' + eye;
        if (features.sprites[sprite]) draw(sprite,features.sprites[sprite]);
        else {
          const geometry = features.eyes[eye];
          draw(eye+'_ball', geometry.ball);
          context.save();context.globalCompositeOperation='source-atop';
          draw(eye+'_iris', geometry.iris, (this.options.gaze?.x || 0)*5,(this.options.gaze?.y || 0)*3);
          context.restore();
          draw(eye+'_lash',geometry.lash);if(geometry.hl)draw(eye+'_hl',geometry.hl);
        }
      }
      const mouth = this.state === 'talking' && Math.sin(seconds*12)>0 ? 'happy_mouth' : (features.sprites[mood+'_mouth'] ? mood+'_mouth' : 'neutral_mouth');
      draw(mouth,features.sprites[mouth],0,mouth==='happy_mouth'?9:0);
    }

    dispose() {
      this.disposed = true;
      this.resizeObserver.disconnect();
      cancelAnimationFrame(this.frame);
      document.removeEventListener('visibilitychange', this.visibility);
      this.reduced.removeEventListener('change', this.media);
    }
  }

  window.ZenixZenbot = {Renderer: ZenbotRenderer, expressions, motions};
})();
