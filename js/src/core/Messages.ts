/*!
 * Buttplug JS Source Code File - Visit https://buttplug.io for more info about
 * the project. Licensed under the BSD 3-Clause license. See LICENSE file in the
 * project root for full license information.
 *
 * @copyright Copyright (c) Nonpolynomial Labs LLC. All rights reserved.
 */

// tslint:disable:max-classes-per-file
'use strict';

import { ButtplugMessageError } from './Exceptions';

export const SYSTEM_MESSAGE_ID = 0;
export const DEFAULT_MESSAGE_ID = 1;
export const MAX_ID = 4294967295;
export const MESSAGE_SPEC_VERSION_MAJOR = 4;
export const MESSAGE_SPEC_VERSION_MINOR = 0;

// Base message interfaces
export interface ButtplugMessage {
  Ok?: Ok;
  Ping?: Ping;
  Error?: Error;
  RequestServerInfo?: RequestServerInfo;
  ServerInfo?: ServerInfo;
  RequestDeviceList?: RequestDeviceList;
  StartScanning?: StartScanning;
  StopScanning?: StopScanning;
  ScanningFinished?: ScanningFinished;
  StopCmd?: StopCmd;
  StopDeviceCmd?: StopDeviceCmd;
  StopAllDevices?: StopAllDevices;
  ScalarCmd?: ScalarCmd;
  LinearCmd?: LinearCmd;
  RotateCmd?: RotateCmd;
  InputCmd?: InputCmd;
  InputReading?: InputReading;
  SensorReadCmd?: SensorCmd;
  SensorSubscribeCmd?: SensorCmd;
  SensorUnsubscribeCmd?: SensorCmd;
  SensorReading?: SensorReading;
  OutputCmd?: OutputCmd;
  DeviceList?: DeviceList;
  DeviceAdded?: DeviceAdded;
  DeviceRemoved?: DeviceRemoved;
}

export function msgId(msg: ButtplugMessage): number {
  for (let [_, entry] of Object.entries(msg)) {
    if (entry != undefined) {
      return entry.Id;
    }
  }
  throw new ButtplugMessageError(`Message ${msg} does not have an ID.`);
}

export function setMsgId(msg: ButtplugMessage, id: number) {
  for (let [_, entry] of Object.entries(msg)) {
    if (entry != undefined) {
      entry.Id = id;
      return;
    }
  }
  throw new ButtplugMessageError(`Message ${msg} does not have an ID.`);
}

export interface Ok {
  Id: number | undefined;
}

export interface Ping {
  Id: number | undefined;
}

export enum ErrorClass {
  ERROR_UNKNOWN,
  ERROR_INIT,
  ERROR_PING,
  ERROR_MSG,
  ERROR_DEVICE,
}

export interface Error {
  ErrorMessage: string;
  ErrorCode: ErrorClass;
  Id: number | undefined;
}

export interface RequestDeviceList {
  Id: number | undefined;
}

export interface StartScanning {
  Id: number | undefined;
}

export interface StopScanning {
  Id: number | undefined;
}

export interface StopAllDevices {
  Id: number | undefined;
}

export interface ScanningFinished {
  Id: number | undefined;
}

export interface RequestServerInfo {
  ClientName: string;
  ProtocolVersionMajor: number;
  ProtocolVersionMinor: number;
  Id: number | undefined;
}

export interface ServerInfo {
  MaxPingTime: number;
  ServerName: string;
  ProtocolVersionMajor: number;
  ProtocolVersionMinor: number;
  Id: number | undefined;
}

export interface DeviceFeature {
  FeatureDescriptor: string;
  Output: { [key: string]: DeviceFeatureOutput };
  Input: { [key: string]: DeviceFeatureInput };
  FeatureIndex: number;
}

export interface DeviceInfo {
  DeviceIndex: number;
  DeviceName: string;
  DeviceFeatures: { [key: number]: DeviceFeature };
  DeviceDisplayName?: string;
  DeviceMessageTimingGap?: number;
}

export interface DeviceList {
  Devices: { [key: number]: DeviceInfo };
  Id: number | undefined;
}

export interface DeviceAdded extends DeviceInfo {
  Id: number | undefined;
}

export interface DeviceRemoved {
  DeviceIndex: number;
  Id: number | undefined;
}

/**
 * Normalize a DeviceFeatures value from the Rust server's serde format (array of
 * {description, feature-type, actuator, sensor}) into the JS client's expected
 * format (object keyed by index with {FeatureDescriptor, Output, Input, FeatureIndex}).
 */
export function normalizeDeviceFeatures(raw: any): { [key: number]: DeviceFeature } {
  // Already in JS format (object keyed by index)
  if (!Array.isArray(raw)) return raw;

  const result: { [key: number]: DeviceFeature } = {};
  const cmdMap: Record<string, string> = {
    SensorReadCmd: 'Read',
    SensorSubscribeCmd: 'Subscribe',
    SensorUnsubscribeCmd: 'Unsubscribe',
  };

  raw.forEach((f: any, i: number) => {
    const feature: DeviceFeature = {
      FeatureDescriptor: f.description || '',
      Output: {},
      Input: {},
      FeatureIndex: i,
    };

    const featureType = f['feature-type'] || 'Unknown';

    if (f.actuator) {
      const range = f.actuator['step-range'] || f.actuator['step-limit'] || [0, 1];
      feature.Output[featureType] = { Value: range[1] || 1 };
    }

    if (f.sensor) {
      const valueRange = f.sensor['value-range'];
      const messages: string[] = f.sensor.messages || [];
      feature.Input[featureType] = {
        Value: valueRange ? valueRange[0] : [0, 1],
        Command: messages.map((c: string) => cmdMap[c] || c) as InputCommandType[],
      };
    }

    result[i] = feature;
  });

  return result;
}

/**
 * Normalize a DeviceInfo, converting Rust feature format if needed.
 */
export function normalizeDeviceInfo(d: any): DeviceInfo {
  return {
    DeviceIndex: d.DeviceIndex,
    DeviceName: d.DeviceName,
    DeviceFeatures: normalizeDeviceFeatures(d.DeviceFeatures),
    DeviceDisplayName: d.DeviceDisplayName,
    DeviceMessageTimingGap: d.DeviceMessageTimingGap,
  };
}

export enum OutputType {
  Unknown = 'Unknown',
  Vibrate = 'Vibrate',
  Rotate = 'Rotate',
  Oscillate = 'Oscillate',
  Constrict = 'Constrict',
  Inflate = 'Inflate',
  Position = 'Position',
  HwPositionWithDuration = 'HwPositionWithDuration',
  Temperature = 'Temperature',
  Spray = 'Spray',
  Led = 'Led',
}

export enum InputType {
  Unknown = 'Unknown',
  Battery = 'Battery',
  RSSI = 'RSSI',
  Button = 'Button',
  Pressure = 'Pressure',
  // Temperature,
  // Accelerometer,
  // Gyro,
}

export enum InputCommandType {
  Read = 'Read',
  Subscribe = 'Subscribe',
  Unsubscribe = 'Unsubscribe',
}

export interface DeviceFeatureInput {
  Value: number[];
  Command: InputCommandType[];
}

export interface DeviceFeatureOutput {
  Value: number;
  Duration?: number;
}

export interface OutputCmd {
  DeviceIndex: number;
  FeatureIndex: number;
  Command: { [key: string]: DeviceFeatureOutput };
  Id: number | undefined;
}

// Device Input Commands

export interface InputCmd {
  DeviceIndex: number;
  FeatureIndex: number;
  Type: InputType;
  Command: InputCommandType;
  Id: number | undefined;
}

export interface InputValue {
  Value: number;
}

export interface InputReading {
  DeviceIndex: number;
  FeatureIndex: number;
  Reading: { [key: string]: InputValue };
  Id: number | undefined;
}

export interface StopCmd {
  Id: number | undefined;
  DeviceIndex: number | undefined;
  FeatureIndex: number | undefined;
  Inputs: boolean | undefined;
  Outputs: boolean | undefined;
}

export interface StopDeviceCmd {
  Id: number | undefined;
  DeviceIndex: number;
}

export interface ScalarSubcommand {
  Index: number;
  Scalar: number;
  ActuatorType: string;
}

export interface ScalarCmd {
  Id: number | undefined;
  DeviceIndex: number;
  Scalars: ScalarSubcommand[];
}

export interface LinearSubcommand {
  Index: number;
  Duration: number;
  Position: number;
}

export interface LinearCmd {
  Id: number | undefined;
  DeviceIndex: number;
  Vectors: LinearSubcommand[];
}

export interface RotateSubcommand {
  Index: number;
  Speed: number;
  Clockwise: boolean;
}

export interface RotateCmd {
  Id: number | undefined;
  DeviceIndex: number;
  Rotations: RotateSubcommand[];
}

export interface SensorCmd {
  Id: number | undefined;
  DeviceIndex: number;
  FeatureIndex: number;
  SensorType: string;
}

export interface SensorReading {
  Id: number | undefined;
  DeviceIndex: number;
  FeatureIndex: number;
  SensorType: string;
  Data: number[];
}
