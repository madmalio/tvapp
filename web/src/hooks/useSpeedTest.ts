import { useState, useEffect } from 'react';
import { getApiUrl } from '../lib/api';

export type StreamQuality = 
  | 'source' 
  | '1080p_high' 
  | '1080p_std' 
  | '720p_high' 
  | '720p_std' 
  | '480p_high' 
  | '480p_std' 
  | '360p_low';

let globalSpeedTestRun = false;
let globalSpeedMbps: number | null = null;

export function useSpeedTest() {
  const [preferredQuality, setPreferredQuality] = useState<StreamQuality>(() => {
    return (localStorage.getItem('preferredQuality') as StreamQuality) || 'source';
  });
  const [speedMbps, setSpeedMbps] = useState<number | null>(globalSpeedMbps);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    if (globalSpeedTestRun) return;
    
    const testSpeed = async () => {
      globalSpeedTestRun = true;
      setIsTesting(true);
      try {
        const startTime = performance.now();
        const response = await fetch(getApiUrl('/api/speedtest'), {
          cache: 'no-store'
        });
        
        if (!response.ok) throw new Error('Speedtest failed');
        
        const blob = await response.blob();
        const endTime = performance.now();
        
        const durationSeconds = (endTime - startTime) / 1000;
        const bitsLoaded = blob.size * 8;
        const speedBps = bitsLoaded / durationSeconds;
        const mbps = speedBps / (1024 * 1024);
        
        globalSpeedMbps = mbps;
        setSpeedMbps(mbps);
        
        // Auto-select quality with a 20% safety margin
        // Required Mbps = target bitrate / 0.8
        let targetQuality: StreamQuality = '360p_low';
        if (mbps > 15) {
          targetQuality = 'source'; // Source might be 12-15Mbps
        } else if (mbps > 10) { // 8 / 0.8
          targetQuality = '1080p_high';
        } else if (mbps > 6.25) { // 5 / 0.8
          targetQuality = '1080p_std';
        } else if (mbps > 5) { // 4 / 0.8
          targetQuality = '720p_high';
        } else if (mbps > 2.5) { // 2 / 0.8
          targetQuality = '720p_std';
        } else if (mbps > 1.875) { // 1.5 / 0.8
          targetQuality = '480p_high';
        } else if (mbps > 1.25) { // 1 / 0.8
          targetQuality = '480p_std';
        } else {
          targetQuality = '360p_low';
        }

        // Only overwrite if they didn't explicitly set it previously
        // Actually, let's always auto-detect on startup to adapt to current network
        setPreferredQuality(targetQuality);
        localStorage.setItem('preferredQuality', targetQuality);

      } catch (err) {
        console.error('Speedtest error:', err);
      } finally {
        setIsTesting(false);
      }
    };

    testSpeed();
  }, []);

  const manuallySetQuality = (quality: StreamQuality) => {
    setPreferredQuality(quality);
    localStorage.setItem('preferredQuality', quality);
  };

  return { preferredQuality, manuallySetQuality, speedMbps, isTesting };
}
