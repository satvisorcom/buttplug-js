import { ButtplugDeviceError, ButtplugError, ButtplugMessageError } from "../core/Exceptions";
import * as Messages from "../core/Messages";
import { DeviceOutputCommand } from "./ButtplugClientDeviceCommand";

export class ButtplugClientDeviceFeature {

  constructor(
    private _deviceIndex: number,
    private _deviceName: string,
    private _feature: Messages.DeviceFeature,
    private _sendClosure: (
      msg: Messages.ButtplugMessage
    ) => Promise<Messages.ButtplugMessage>) {
  }

  protected send = async (msg: Messages.ButtplugMessage): Promise<Messages.ButtplugMessage> => {
    return await this._sendClosure(msg);
  }

  protected sendMsgExpectOk = async (
    msg: Messages.ButtplugMessage
  ): Promise<void> => {
    const response = await this.send(msg);
    if (response.Ok !== undefined) {
      return;
    } else if (response.Error !== undefined) {
      throw ButtplugError.FromError(response as Messages.Error);
    } else {
      throw new ButtplugMessageError("Expected Ok or Error, and didn't get either!");
    }
  };

  protected isOutputValid(type: Messages.OutputType) {
    if (this._feature.Output !== undefined && !this._feature.Output.hasOwnProperty(type)) {
      throw new ButtplugDeviceError(`Feature index ${this._feature.FeatureIndex} does not support type ${type} for device ${this._deviceName}`);
    }
  }

  protected isInputValid(type: Messages.InputType) {
    if (this._feature.Input !== undefined && !this._feature.Input.hasOwnProperty(type)) {
      throw new ButtplugDeviceError(`Feature index ${this._feature.FeatureIndex} does not support type ${type} for device ${this._deviceName}`);
    }
  }

  protected async sendOutputCmd(command: DeviceOutputCommand): Promise<void> {
    this.isOutputValid(command.outputType);
    if (command.value === undefined) {
      throw new ButtplugDeviceError(`${command.outputType} requires value defined`);
    }

    const type = command.outputType;
    let scalar: number;
    if (command.value.percent !== undefined) {
      scalar = command.value.percent;
    } else {
      const maxSteps = this._feature.Output[type]?.Value ?? 1;
      scalar = maxSteps > 0 ? command.value.steps! / maxSteps : 0;
    }

    let cmd: Messages.ButtplugMessage;

    if (type === Messages.OutputType.Rotate) {
      cmd = {
        RotateCmd: {
          Id: 1,
          DeviceIndex: this._deviceIndex,
          Rotations: [{
            Index: this._feature.FeatureIndex,
            Speed: scalar,
            Clockwise: true,
          }]
        }
      };
    } else if (type === Messages.OutputType.Position || type === Messages.OutputType.HwPositionWithDuration) {
      if (command.duration === undefined) {
        throw new ButtplugDeviceError("Position commands require duration");
      }
      cmd = {
        LinearCmd: {
          Id: 1,
          DeviceIndex: this._deviceIndex,
          Vectors: [{
            Index: this._feature.FeatureIndex,
            Duration: command.duration,
            Position: scalar,
          }]
        }
      };
    } else {
      // All scalar actuators: Vibrate, Oscillate, Constrict, Inflate, etc.
      cmd = {
        ScalarCmd: {
          Id: 1,
          DeviceIndex: this._deviceIndex,
          Scalars: [{
            Index: this._feature.FeatureIndex,
            Scalar: scalar,
            ActuatorType: type,
          }]
        }
      };
    }

    await this.sendMsgExpectOk(cmd);
  }

  public hasOutput(type: Messages.OutputType): boolean {
    if (this._feature.Output !== undefined) {
      return this._feature.Output.hasOwnProperty(type.toString());
    }
    return false;
  }

  public hasInput(type: Messages.InputType): boolean {
    if (this._feature.Input !== undefined) {
      return this._feature.Input.hasOwnProperty(type.toString());
    }
    return false;
  }


  public async runOutput(cmd: DeviceOutputCommand): Promise<void> {
    if (this._feature.Output !== undefined && this._feature.Output.hasOwnProperty(cmd.outputType.toString())) {
      return this.sendOutputCmd(cmd);
    }
    throw new ButtplugDeviceError(`Output type ${cmd.outputType} not supported by feature.`);
  }

  public async runInput(inputType: Messages.InputType, inputCommand: Messages.InputCommandType): Promise<Messages.InputReading | undefined> {
    this.isInputValid(inputType);

    const sensorCmd: Messages.SensorCmd = {
      Id: 1,
      DeviceIndex: this._deviceIndex,
      FeatureIndex: this._feature.FeatureIndex,
      SensorType: inputType,
    };

    let cmd: Messages.ButtplugMessage;
    if (inputCommand === Messages.InputCommandType.Read) {
      cmd = { SensorReadCmd: sensorCmd };
    } else if (inputCommand === Messages.InputCommandType.Subscribe) {
      cmd = { SensorSubscribeCmd: sensorCmd };
    } else {
      cmd = { SensorUnsubscribeCmd: sensorCmd };
    }

    if (inputCommand === Messages.InputCommandType.Read) {
      const response = await this.send(cmd);
      if (response.SensorReading !== undefined) {
        // Convert v4 SensorReading to InputReading format for compatibility
        // Battery Data is [0-100] in v4, normalize to 0-1
        let value = response.SensorReading.Data[0];
        if (response.SensorReading.SensorType === Messages.InputType.Battery) {
          if (value > 100) {
            value = value / 10000;  // raw format like 9100 = 91%
          } else if (value > 1) {
            value = value / 100;    // percentage like 91 = 91%
          }
          // else already 0-1
        }
        const reading: Messages.InputReading = {
          DeviceIndex: response.SensorReading.DeviceIndex,
          FeatureIndex: response.SensorReading.FeatureIndex,
          Reading: {
            [response.SensorReading.SensorType]: { Value: value }
          },
          Id: response.SensorReading.Id,
        };
        return reading;
      } else if (response.Error !== undefined) {
        throw ButtplugError.FromError(response as Messages.Error);
      } else {
        throw new ButtplugMessageError("Expected SensorReading or Error, and didn't get either!");
      }
    } else {
      await this.sendMsgExpectOk(cmd);
    }
  }
}