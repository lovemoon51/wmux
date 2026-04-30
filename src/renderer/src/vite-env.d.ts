/// <reference types="vite/client" />

import type { WmuxApi } from "../../../preload";

declare global {
  interface Window {
    wmux?: WmuxApi;
  }
}
