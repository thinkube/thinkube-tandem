/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./fonts/fonts.css";

createRoot(document.getElementById("root")!).render(<App />);
