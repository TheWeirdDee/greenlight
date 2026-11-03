import { afterAll, afterEach } from "vitest";
import { closeAll, stopServer } from "./harness";

afterEach(closeAll);
afterAll(stopServer);
