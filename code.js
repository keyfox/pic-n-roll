async function scanFiles(entry, out) {
  if (entry.isDirectory) {
    const entryReader = entry.createReader();
    const entries = await new Promise((resolve) => {
      entryReader.readEntries((entries) => resolve(entries));
    });
    await Promise.all(entries.map((entry) => scanFiles(entry, out)));
  } else if (entry.isFile) {
    out.push(entry);
  }
}

const IMAGE_EXT = ["jpg", "jpeg", "png", "bmp", "gif"].reduce((dict, e) => {
  dict[e] = true;
  return dict;
}, {});

function hasImageExt(filename) {
  return IMAGE_EXT[filename.split(".").pop().toLowerCase()];
}

let dragEventTarget = null;
let lastPickedIndex = -1;
const HISTORY_MAX_LENGTH = 32;
const IMAGE_CACHE_MAX_LENGTH = HISTORY_MAX_LENGTH + 1;
let imagesCreated = 0;
const DEBOUNCE_DELAY = 125;
let loadTimeTimer;
let lastMouseMove = 0;

const PickNRollApp = {
  data() {
    return {
      // history of images. newer comes first.
      history: [],
      // the ID of image currently shown.
      shownImageId: null,
      // the last image which completely loaded
      lastImageLoaded: null,
      loadingTakingTime: null,
      // the images loaded.
      images: {},
      // the ID of image user really wants to show.
      imagePendingToShow: null,
      // candidate images to pick from.
      candidates: null,
      // indicates whether files or directories are being dragged.
      dragHovering: false,
      // indicates whether the app is searching for image files.
      loadingDroppedItem: false,
      // indicates whether the user is actively using the app.
      userActive: false,
      imageScalePercentage: 100,
      mainColumnWidth: null,
      mainColumnHeight: null,
      // Where the drag event for moving image has been fired (at screen position)
      imageMoveEventSrcPos: null,
      // the position of image just before the image movement
      imageMoveFromPos: null,
      // where the image object should be placed; (0, 0) is the center of main column
      imageTop: 0,
      imageLeft: 0,
    };
  },
  mounted() {
    window.addEventListener("dragenter", (ev) => {
      ev.preventDefault();
      dragEventTarget = ev.target;
      this.dragHovering = true;
    });
    window.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "link";
    });
    window.addEventListener("drop", async (ev) => {
      ev.preventDefault();
      this.dragHovering = false;
      this.loadingDroppedItem = true;
      const droppedItems = ev.dataTransfer.items;
      const entries = [];
      const promises = [];
      for (const d of droppedItems) {
        const entry = d.webkitGetAsEntry();
        promises.push(scanFiles(entry, entries));
      }
      await Promise.all(promises);
      this.candidates = entries.filter((e) => hasImageExt(e.name));
      lastPickedIndex = -1;
      this.loadingDroppedItem = false;
      this.shownItem = null;
      this.roll();
    });
    window.addEventListener("dragleave", (ev) => {
      ev.preventDefault();
      if (ev.target === dragEventTarget || ev.target === document) {
        this.dragHovering = false;
      }
    });
    (() => {
      const inactivityDebounce = throttleDebounce.debounce(3000, false, () => {
        this.userActive = false;
      });
      const activate = () => {
        if (!this.userActive) {
          this.userActive = true;
        }
        inactivityDebounce();
      };
      window.addEventListener("mousemove", activate);
      window.addEventListener("mousedown", activate);
    })();
    (() => {
      const mainColumn = this.$refs.mainColumn;
      const observer = new ResizeObserver(this.updateMainColumnDimension);
      observer.observe(mainColumn);
      this.updateMainColumnDimension();
    })();
  },
  methods: {
    addHistory(item) {
      // aliasing
      const h = this.history;
      // add an item into history.
      this.history = [
        item,
        ...(h.length < HISTORY_MAX_LENGTH ? h : h.slice(0, -1)),
      ];
    },
    async show(imageId, opts) {
      opts = { addHistory: false, ...(opts || {}) };
      const img = this.images[imageId];

      this.imagePendingToShow = imageId;
      if (opts.addHistory) {
        this.addHistory({ id: imageId, loaded: false });
      }
      await img.readyToLoadPromise;

      if (this.imagePendingToShow !== imageId) {
        return;
      }
      this.shownImageId = imageId;
      this.imagePendingToShow = null;

      // set scale to fit the window
      const ratio = Math.min(
        this.mainColumnWidth / img.width,
        this.mainColumnHeight / img.height
      );
      this.imageScalePercentage = ratio * 100;
      this.imageLeft = 0;
      this.imageTop = 0;

      // tell `dragscroll` library to find targets
      await this.$nextTick();
      dragscroll.reset();
    },
    async loadImageFile(fileEntry) {
      // assign an unique ID for each load
      const id = imagesCreated;
      ++imagesCreated;

      const ids = Object.keys(this.images);
      if (ids.length >= IMAGE_CACHE_MAX_LENGTH) {
        // The first come first eliminated for cache capacity
        const elim = ids
          .map((e) => parseInt(e, 10))
          .reduce((a, b) => Math.min(a, b))
          .toString();
        await this.images[elim].destroy();
        this.history = this.history.filter((i) => i !== parseInt(elim, 10));
        delete this.images[elim];
      }

      const createObjectURLPromise = new Promise((resolve) => {
        fileEntry.file((f) => {
          resolve(URL.createObjectURL(f));
        });
      });
      const imageObjectPromise = createObjectURLPromise.then(
        (url) =>
          new Promise((resolve) => {
            const img = new Image();
            img.src = url;
            img.onload = () => resolve(img);
            return img;
          })
      );

      const item = {
        path: fileEntry.fullPath,
        name: fileEntry.name,
        objectUrl: createObjectURLPromise,
        width: imageObjectPromise.then((img) => img.width),
        height: imageObjectPromise.then((img) => img.height),
        async destroy() {
          URL.revokeObjectURL(await this.objectUrl);
        },
      };

      this.images[id] = {
        readyToLoad: false,
      };
      this.images[id].readyToLoadPromise = Promise.all(
        Object.keys(item).map(async (k) => {
          // change `readyToLoad` property to `true` once all values in `item` is determined
          const value = await Promise.resolve(item[k]);
          this.images[id][k] = value;
        })
      ).then(() => {
        this.images[id].readyToLoad = true;
      });

      return id;
    },
    async showFile(fileEntry, opts) {
      const id = await this.loadImageFile(fileEntry);
      this.show(id, opts);
    },
    roll() {
      // aliasing
      const ca = this.candidates;

      // pick an index taking consecutive selection into account
      const index = (() => {
        let i = null;
        do {
          i = Math.floor(Math.random() * ca.length);
        } while (i === lastPickedIndex && ca.length >= 2);
        return i;
      })();
      lastPickedIndex = index;

      const picked = ca[index];
      this.showFile(picked, { addHistory: true });
    },
    handleWheelOnImage(ev) {
      const T = 1.1;
      const curr = this.imageScalePercentage;
      const level = Math.log(curr) / Math.log(T);
      const nextLevel = level + -ev.deltaY * 0.01;

      this.imageScalePercentage = Math.pow(T, nextLevel);
    },
    updateMainColumnDimension() {
      const el = this.$refs.mainColumn;
      this.mainColumnWidth = el.clientWidth;
      this.mainColumnHeight = el.clientHeight;
    },
    _moveImageWithDrag(ev) {
      const { x: srcX, y: srcY } = this.imageMoveEventSrcPos;
      const { x: fromX, y: fromY } = this.imageMoveFromPos;
      const diffX = ev.screenX - srcX;
      const diffY = ev.screenY - srcY;
      this.imageLeft = fromX + diffX;
      this.imageTop = fromY + diffY;
    },
    moveImageMouseDown(ev) {
      this.imageMoveEventSrcPos = { x: ev.screenX, y: ev.screenY };
      this.imageMoveFromPos = { x: this.imageLeft, y: this.imageTop };
    },
    moveImageMouseMove(ev) {
      if (!this.imageMoveEventSrcPos) {
        return;
      }
      this._moveImageWithDrag(ev);
    },
    moveImageMouseUp(ev) {
      if (!this.imageMoveEventSrcPos) {
        return;
      }
      this._moveImageWithDrag(ev);
      this.imageMoveEventSrcPos = null;
    },
  },
  computed: {
    candidatesCount() {
      return this.itemsDropped ? this.candidates.length : 0;
    },
    itemsDropped() {
      return this.candidates !== null;
    },
    shownImage() {
      return this.shownImageId === null ? null : this.images[this.shownImageId];
    },
    imageTransform() {
      return {
        top: `calc(50% + ${this.imageTop}px)`,
        left: `calc(50% + ${this.imageLeft}px)`,
        transform: `translate(-50%, -50%) scale(${
          this.imageScalePercentage / 100
        })`,
      };
    },
    shownImageLoaded() {
      return this.shownImageId === this.lastImageLoaded;
    },
  },
  watch: {
    shownImageId(newValue, oldValue) {
      if (newValue !== oldValue) {
        // TODO: is this `if` not needed?
        // TODO: possibly we can use `debounce` here
        clearTimeout(loadTimeTimer);
        this.loadingTakingTime = false;
        loadTimeTimer = setTimeout(() => {
          this.loadingTakingTime = true;
        }, DEBOUNCE_DELAY);
      }
    },
  },
};

Vue.createApp(PickNRollApp).mount("#root");
