declare module "mp4box" {
  // 极简声明，仅覆盖本工程用到的 API
  export interface MP4VideoTrack {
    id: number;
    codec: string;
    timescale: number;
    nb_samples: number;
    video?: { width: number; height: number };
  }
  export interface MP4AudioTrack {
    id: number;
    codec: string;
    timescale: number;
    nb_samples: number;
    audio?: { sampleRate: number; channels: number };
  }
  export interface MP4Info {
    duration: number;
    timescale: number;
    videoTracks: MP4VideoTrack[];
    audioTracks: MP4AudioTrack[];
  }
  export const DataStream: any;
  const MP4Box: {
    createFile: () => any;
    DataStream: any;
  };
  export default MP4Box;
}
