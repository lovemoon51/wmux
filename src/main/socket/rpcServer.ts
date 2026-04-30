import { createServer, type Server, type Socket } from "node:net";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { SocketRpcErrorCode, SocketRpcErrorDetails, SocketRpcRequest, SocketRpcResponse } from "../../shared/types";

const maxFrameLength = 1024 * 1024;

export type SocketRpcServer = {
  path: string;
  close: () => Promise<void>;
};

export type RegisterSocketRpcServerOptions = {
  dispatch: (request: SocketRpcRequest) => Promise<unknown>;
  path?: string;
  securityMode?: SocketSecurityMode;
  token?: string;
};

export type SocketSecurityMode = "off" | "wmuxOnly" | "token" | "allowAll";

export function getDefaultSocketPath(): string {
  if (process.env.WMUX_SOCKET_PATH) {
    return process.env.WMUX_SOCKET_PATH;
  }

  if (process.platform === "win32") {
    const safeUserDataPath = dirname(process.execPath).replace(/[^a-zA-Z0-9]/g, "-");
    return `\\\\.\\pipe\\wmux-${safeUserDataPath}`;
  }

  return join(tmpdir(), "wmux.sock");
}

export async function registerSocketRpcServer({
  dispatch,
  path,
  securityMode = "wmuxOnly",
  token
}: RegisterSocketRpcServerOptions): Promise<SocketRpcServer> {
  if (securityMode === "off") {
    throw createRpcError("INVALID_STATE", "socket server is disabled");
  }

  const socketPath = path ?? getDefaultSocketPath();
  const server = createServer((socket) => handleConnection(socket, dispatch, { securityMode, token }));

  if (process.platform !== "win32") {
    await mkdir(dirname(socketPath), { recursive: true });
    await unlink(socketPath).catch(() => undefined);
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });

  process.env.WMUX_SOCKET_PATH = socketPath;

  return {
    path: socketPath,
    close: () => closeServer(server, socketPath)
  };
}

function handleConnection(
  socket: Socket,
  dispatch: (request: SocketRpcRequest) => Promise<unknown>,
  auth: { securityMode: SocketSecurityMode; token?: string }
): void {
  socket.setEncoding("utf8");
  let buffer = "";

  socket.on("data", (chunk) => {
    buffer += chunk;

    if (buffer.length > maxFrameLength) {
      writeResponse(socket, createErrorResponse("unknown", "BAD_REQUEST", "请求体过大"));
      socket.destroy();
      return;
    }

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const frame = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (frame) {
        void handleFrame(socket, frame, dispatch, auth);
      }

      newlineIndex = buffer.indexOf("\n");
    }
  });
}

async function handleFrame(
  socket: Socket,
  frame: string,
  dispatch: (request: SocketRpcRequest) => Promise<unknown>,
  auth: { securityMode: SocketSecurityMode; token?: string }
): Promise<void> {
  let request: SocketRpcRequest;

  try {
    request = JSON.parse(frame) as SocketRpcRequest;
  } catch {
    writeResponse(socket, createErrorResponse("unknown", "BAD_REQUEST", "请求必须是 JSON line"));
    return;
  }

  if (!request || typeof request.id !== "string" || typeof request.method !== "string") {
    writeResponse(socket, createErrorResponse("unknown", "BAD_REQUEST", "请求必须包含字符串 id 和 method"));
    return;
  }

  if (!isAuthorizedRequest(request, auth)) {
    writeResponse(
      socket,
      createErrorResponse(request.id, "UNAUTHORIZED", "socket token missing or invalid", {
        securityMode: auth.securityMode
      })
    );
    return;
  }

  try {
    if (request.method === "system.ping") {
      writeResponse(socket, { id: request.id, ok: true, result: { pong: true } });
      return;
    }

    const result = await dispatch(request);
    writeResponse(socket, { id: request.id, ok: true, result });
  } catch (error) {
    writeResponse(socket, normalizeError(request.id, error));
  }
}

function isAuthorizedRequest(
  request: SocketRpcRequest,
  { securityMode, token }: { securityMode: SocketSecurityMode; token?: string }
): boolean {
  if (securityMode === "allowAll") {
    return true;
  }

  if (!token) {
    return false;
  }

  return request.auth?.token === token;
}

function writeResponse(socket: Socket, response: SocketRpcResponse): void {
  socket.write(`${JSON.stringify(response)}\n`);
}

export function createRpcError(
  code: SocketRpcErrorCode,
  message: string,
  details?: SocketRpcErrorDetails
): Error & { code: SocketRpcErrorCode; details?: SocketRpcErrorDetails } {
  const error = new Error(message) as Error & { code: SocketRpcErrorCode; details?: SocketRpcErrorDetails };
  error.code = code;
  error.details = details;
  return error;
}

function normalizeError(id: string, error: unknown): SocketRpcResponse {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return createErrorResponse(
      id,
      error.code as SocketRpcErrorCode,
      error.message,
      "details" in error ? (error.details as SocketRpcErrorDetails) : undefined
    );
  }

  return createErrorResponse(id, "INTERNAL", error instanceof Error ? error.message : "内部错误");
}

function createErrorResponse(
  id: string,
  code: SocketRpcErrorCode,
  message: string,
  details?: SocketRpcErrorDetails
): SocketRpcResponse {
  return {
    id,
    ok: false,
    error: { code, message, details }
  };
}

async function closeServer(server: Server, socketPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }).catch(() => undefined);

  if (process.platform !== "win32") {
    await unlink(socketPath).catch(() => undefined);
  }
}
