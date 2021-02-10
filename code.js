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
      imageTranslateX: 0,
      imageTranslateY: 0,
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

      this.imagePendingToShow = imageId;
      if (opts.addHistory) {
        this.addHistory({ id: imageId, loaded: false });
      }
      await this.images[imageId].readyPromise;

      if (this.imagePendingToShow !== imageId) {
        return;
      }
      this.shownImageId = imageId;
      this.imagePendingToShow = null;
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

      const item = {
        path: fileEntry.fullPath,
        name: fileEntry.name,
        objectUrl: new Promise((resolve) => {
          fileEntry.file((f) => {
            resolve(URL.createObjectURL(f));
          });
        }),
        async destroy() {
          URL.revokeObjectURL(await this.objectUrl);
        },
      };

      this.images[id] = {
        ready: false,
      };
      this.images[id].readyPromise = Promise.all(
        Object.keys(item).map(async (k) => {
          const value = await Promise.resolve(item[k]);
          this.images[id][k] = value;
        })
      ).then(() => {
        this.images[id].ready = true;
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
        transform: `translate(${this.imageTranslateX}px, ${
          this.imageTranslateY
        }px) scale(${this.imageScalePercentage / 100.0})`,
      };
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
