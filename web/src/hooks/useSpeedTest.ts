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
let globalPreferredQuality: StreamQuality | null = null;
let listeners: Array<() => void> = [];

export function useSpeedTest() {
  const [preferredQuality, setPreferredQuality] = useState<StreamQuality>(() => {
    return globalPreferredQuality || (localStorage.getItem('preferredQuality') as StreamQuality) || 'source';
  });
  const [speedMbps, setSpeedMbps] = useState<number | null>(globalSpeedMbps);
  const [isTesting, setIsTesting] = useState(!globalSpeedTestRun || (globalSpeedTestRun && globalSpeedMbps === null));

  useEffect(() => {
    const handler = () => {
      if (globalPreferredQuality) setPreferredQuality(globalPreferredQuality);
      if (globalSpeedMbps !== null) setSpeedMbps(globalSpeedMbps);
      setIsTesting(false);
    };
    listeners.push(handler);
    return () => {
      listeners = listeners.filter(l => l !== handler);
    };
  }, []);

  useEffect(() => {
    if (globalSpeedTestRun) return;
    globalSpeedTestRun = true;
    setIsTesting(true);
    
    const testSpeed = async () => {
      try {
        const startTime = performance.now();
        const response = await fetch(getApiUrl('/api/speedtest'), { cache: 'no-store' });
        
        if (!response.ok) throw new Error('Speedtest failed');
        
        const blob = await response.blob();
        const endTime = performance.now();
        
        const durationSeconds = (endTime - startTime) / 1000;
        const bitsLoaded = blob.size * 8;
        const speedBps = bitsLoaded / durationSeconds;
        const mbps = speedBps / (1024 * 1024);
        
        globalSpeedMbps = mbps;
        
        let targetQuality: StreamQuality = '360p_low';
        if (mbps > 15) {
          targetQuality = 'source';
        } else if (mbps > 10) {
          targetQuality = '1080p_high';
        } else if (mbps > 6.25) {
          targetQuality = '1080p_std';
        } else if (mbps > 5) {
          targetQuality = '720p_high';
        } else if (mbps > 2.5) {
          targetQuality = '720p_std';
        } else if (mbps > 1.875) {
          targetQuality = '480p_high';
        } else if (mbps > 1.25) {
          targetQuality = '480p_std';
        } else {
          targetQuality = '360p_low';
        }

        if (!localStorage.getItem('userQualitySet')) {
            globalPreferredQuality = targetQuality;
            localStorage.setItem('preferredQuality', targetQuality);
        } else {
            globalPreferredQuality = (localStorage.getItem('preferredQuality') as StreamQuality) || 'source';
        }

      } catch (err) {
        console.error('Speedtest error:', err);
      } finally {
        listeners.forEach(l => l());
      }
    };
    testSpeed();
  }, []);

  const manuallySetQuality = (quality: StreamQuality) => {
    globalPreferredQuality = quality;
    localStorage.setItem('preferredQuality', quality);
    localStorage.setItem('userQualitySet', 'true');
    listeners.forEach(l => l());
  };

  return { preferredQuality, manuallySetQuality, speedMbps, isTesting };
}
