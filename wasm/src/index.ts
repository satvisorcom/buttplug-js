import { ButtplugMessage, IButtplugClientConnector } from '@satvisorcom/buttplug';
import { EventEmitter } from 'eventemitter3';

export class ButtplugWasmClientConnector extends EventEmitter implements IButtplugClientConnector {
  private static _loggingActivated = false;
  private static wasmInstance: any;
  private _connected: boolean = false;
  private client: any;
  private serverPtr: any;

  constructor() {
    super();
  }

  public get Connected(): boolean { return this._connected }

  private static maybeLoadWasm = async() => {
    if (ButtplugWasmClientConnector.wasmInstance == undefined) {
      ButtplugWasmClientConnector.wasmInstance = await import('@/../rust/pkg/buttplug_wasm.js');
    }
  }

  public static activateLogging = async (logLevel: string = "debug") => {
    await ButtplugWasmClientConnector.maybeLoadWasm();
    if (this._loggingActivated) {
      console.log("Logging already activated, ignoring.");
      return;
    }
    console.log("Turning on logging.");
    ButtplugWasmClientConnector.wasmInstance.buttplug_activate_env_logger(logLevel);
  }

  public initialize = async (): Promise<void> => {};

  public connect = async (): Promise<void> => {
    await ButtplugWasmClientConnector.maybeLoadWasm();
    this.client = ButtplugWasmClientConnector.wasmInstance.buttplug_create_embedded_wasm_server((msgs: Uint8Array) => {
      this.emitMessage(msgs);
    }, this.serverPtr);
    this._connected = true;
  };

  public disconnect = async (): Promise<void> => {};

  public send = (msg: ButtplugMessage): void => {
    ButtplugWasmClientConnector.wasmInstance.buttplug_client_send_json_message(this.client, new TextEncoder().encode('[' + JSON.stringify(msg) + ']'), (output: Uint8Array) => {
      this.emitMessage(output);
    });
  };

  private emitMessage = (msg: Uint8Array) => {
    const str = new TextDecoder().decode(msg);
    const msgs: ButtplugMessage[] = JSON.parse(str);
    this.emit('message', msgs);
  }
}
