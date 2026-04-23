"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const teams_1 = __importDefault(require("./api/inbound/teams"));
const feishu_1 = __importDefault(require("./api/inbound/feishu"));
const queue_1 = require("./infra/queue");
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use("/api/v1/inbound/teams", teams_1.default);
app.use("/api/v1/inbound/feishu", feishu_1.default);
app.get("/health", (_req, res) => res.json({ status: "ok", version: "2.0.0" }));
const PORT = parseInt(process.env.PORT || "3978", 10);
app.listen(PORT, () => { console.log(`🚀 Bridge Service v2 running on port ${PORT}`); queue_1.outboundQueue.start(); });
//# sourceMappingURL=index.js.map