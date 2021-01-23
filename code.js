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
const IMAGE_CACHE_MAX_LENGTH = HISTORY_MAX_LENGTH;
let imagesCreated = 0;
const DEBOUNCE_DELAY = 0;

const PickNRollApp = {
  data() {
    return {
      // history of images. newer comes first.
      history: [],
      // the ID of image currently shown.
      shownImageId: null,
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
      opts = { addHistory: false, when: Promise.resolve(), ...(opts || {}) };

      this.imagePendingToShow = imageId;
      if (opts.addHistory) {
        this.addHistory(imageId);
      }
      opts.when.then(() => {
        if (this.imagePendingToShow !== imageId) {
          return;
        }
        this.shownImageId = imageId;
        this.imagePendingToShow = null;
      });
    },
    loadImageFile(item) {
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
        delete this.images[elim];
      }

      this.images[id] = { loading: true, tookTimeToLoad: false };
      const loadPromise = Promise.all(
        Object.keys(item).map((k) => {
          return Promise.resolve(item[k]).then((value) => {
            this.images[id][k] = value;
          });
        })
      ).then(() => {
        this.images[id].loading = false;
      });
      setTimeout(() => (this.images[id].tookTimeToLoad = true), DEBOUNCE_DELAY);

      return { id, loadPromise };
    },
    async showFile(fileEntry, opts) {
      const item = {
        path: fileEntry.fullPath,
        name: fileEntry.name,
        src: new Promise((resolve) => {
          setTimeout(() => {
            fileEntry.file((f) => {
              const reader = new FileReader();
              reader.readAsDataURL(f);
              reader.addEventListener("load", async () => {
                resolve(reader.result);
              });
            });
          }, 0);
        }),
      };
      const { id, loadPromise } = this.loadImageFile(item);
      this.show(id, {
        ...opts,
        when: Promise.race([
          new Promise((resolve) => setTimeout(resolve, DEBOUNCE_DELAY)),
          loadPromise,
        ]),
      });
    },
    roll() {
      // aliasing
      const ca = this.candidates;

      // pick an index taking consecutive selection into account
      const index = (() => {
        let i = null;
        do {
          i = Math.floor(Math.random() * ca.length);
        } while (i === lastPickedIndex);
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
  },
};

Vue.createApp(PickNRollApp).mount("#root");
