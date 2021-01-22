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

const PickNRollApp = {
  data() {
    return {
      // history of images. newer comes first.
      history: [],
      // the image currently shown.
      shownItem: null,
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
    show(e) {
      this.shownItem = e;
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
      picked.file((f) => {
        const reader = new FileReader();
        reader.readAsDataURL(f);
        reader.addEventListener("load", () => {
          const item = {
            path: picked.fullPath,
            name: picked.name,
            src: reader.result,
          };
          this.shownItem = item;
          const h = this.history;
          this.history = [
            item,
            ...(h.length < HISTORY_MAX_LENGTH
              ? this.history
              : this.history.slice(0, -1)),
          ];
        });
      });
    },
  },
  computed: {
    candidatesCount() {
      return this.itemsDropped ? this.candidates.length : 0;
    },
    itemsDropped() {
      return this.candidates !== null;
    },
  },
};

Vue.createApp(PickNRollApp).mount("#root");
