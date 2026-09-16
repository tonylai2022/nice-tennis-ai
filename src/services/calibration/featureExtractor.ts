/**
 * calibration/featureExtractor.ts
 * Pure function for extracting PoseFeatures from a PoseResult.
 * SRP: No storage, no classification — only feature computation.
 */

import { PoseResult } from '../MotionAnalysisRouter';
import { PoseFeatures } from './types';

/** 2D angle at joint B between vectors BA and BC (degrees) */
function angle2D(a: any, b: any, c: any): number {
    if (!a || !b || !c) return 90;
    const ba = { x: a.x - b.x, y: a.y - b.y };
    const bc = { x: c.x - b.x, y: c.y - b.y };
    const dot = ba.x * bc.x + ba.y * bc.y;
    const magBA = Math.sqrt(ba.x ** 2 + ba.y ** 2);
    const magBC = Math.sqrt(bc.x ** 2 + bc.y ** 2);
    if (magBA < 0.001 || magBC < 0.001) return 90;
    const cos = Math.max(-1, Math.min(1, dot / (magBA * magBC)));
    return Math.acos(cos) * (180 / Math.PI);
}

/** 3D angle at joint B between vectors BA and BC (degrees) */
function angle3D(a: any, b: any, c: any): number {
    if (!a || !b || !c) return 90;
    const ba = { x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) };
    const bc = { x: c.x - b.x, y: c.y - b.y, z: (c.z || 0) - (b.z || 0) };
    const dot = ba.x * bc.x + ba.y * bc.y + ba.z * bc.z;
    const magBA = Math.sqrt(ba.x ** 2 + ba.y ** 2 + ba.z ** 2);
    const magBC = Math.sqrt(bc.x ** 2 + bc.y ** 2 + bc.z ** 2);
    if (magBA < 0.001 || magBC < 0.001) return 90;
    const cos = Math.max(-1, Math.min(1, dot / (magBA * magBC)));
    return Math.acos(cos) * (180 / Math.PI);
}

/** Returns true when the Z-axis in the landmark set carries meaningful data */
function zIsMeaningful(wl: any[]): boolean {
    const idxs = [11, 12, 14, 16, 23, 24, 26, 28];
    let sumAbs = 0;
    let n = 0;
    for (const i of idxs) {
        const z = wl?.[i]?.z;
        if (typeof z !== 'number') continue;
        sumAbs += Math.abs(z);
        n++;
    }
    return n >= 4 && sumAbs / n > 0.01;
}

/**
 * Extract a PoseFeatures vector from a single pose frame.
 * prevPose is used to compute wrist velocity.
 */
export function extractFeatures(pose: PoseResult, prevPose?: PoseResult): PoseFeatures {
    const wl = pose.worldLandmarks || pose.landmarks;
    const use3D = zIsMeaningful(wl);
    const angle = use3D ? angle3D : angle2D;

    // Wrist velocities
    let rightWristVel = 0;
    let leftWristVel = 0;
    if (prevPose) {
        const prevWl = prevPose.worldLandmarks || prevPose.landmarks;
        const dt = pose.timestamp - prevPose.timestamp;
        if (dt > 0.001) {
            if (wl[16] && prevWl[16]) {
                const dx = wl[16].x - prevWl[16].x;
                const dy = wl[16].y - prevWl[16].y;
                rightWristVel = use3D
                    ? Math.sqrt(dx * dx + dy * dy + ((wl[16].z || 0) - (prevWl[16].z || 0)) ** 2) / dt
                    : Math.sqrt(dx * dx + dy * dy) / dt;
            }
            if (wl[15] && prevWl[15]) {
                const dx = wl[15].x - prevWl[15].x;
                const dy = wl[15].y - prevWl[15].y;
                leftWristVel = use3D
                    ? Math.sqrt(dx * dx + dy * dy + ((wl[15].z || 0) - (prevWl[15].z || 0)) ** 2) / dt
                    : Math.sqrt(dx * dx + dy * dy) / dt;
            }
        }
    }

    const shoulderCenterX = ((wl[11]?.x || 0) + (wl[12]?.x || 0)) / 2;
    const shoulderCenterY = ((wl[11]?.y || 0) + (wl[12]?.y || 0)) / 2;
    const shoulderCenterZ = ((wl[11]?.z || 0) + (wl[12]?.z || 0)) / 2;
    const hipCenterX = ((wl[23]?.x || 0) + (wl[24]?.x || 0)) / 2;
    const hipCenterY = ((wl[23]?.y || 0) + (wl[24]?.y || 0)) / 2;
    const hipCenterZ = ((wl[23]?.z || 0) + (wl[24]?.z || 0)) / 2;

    // Trunk rotation (shoulder-hip separation angle)
    let trunkRotation = 0;
    if (wl[11] && wl[12] && wl[23] && wl[24]) {
        if (use3D) {
            const sv = { x: wl[12].x - wl[11].x, z: (wl[12].z || 0) - (wl[11].z || 0) };
            const hv = { x: wl[24].x - wl[23].x, z: (wl[24].z || 0) - (wl[23].z || 0) };
            const dot = sv.x * hv.x + sv.z * hv.z;
            const m1 = Math.sqrt(sv.x ** 2 + sv.z ** 2);
            const m2 = Math.sqrt(hv.x ** 2 + hv.z ** 2);
            if (m1 > 0.001 && m2 > 0.001) {
                trunkRotation = Math.acos(Math.max(-1, Math.min(1, dot / (m1 * m2)))) * (180 / Math.PI);
            }
        } else {
            const sv = { x: wl[12].x - wl[11].x, y: wl[12].y - wl[11].y };
            const hv = { x: wl[24].x - wl[23].x, y: wl[24].y - wl[23].y };
            const dot = sv.x * hv.x + sv.y * hv.y;
            const m1 = Math.sqrt(sv.x ** 2 + sv.y ** 2);
            const m2 = Math.sqrt(hv.x ** 2 + hv.y ** 2);
            if (m1 > 0.001 && m2 > 0.001) {
                trunkRotation = Math.acos(Math.max(-1, Math.min(1, dot / (m1 * m2)))) * (180 / Math.PI);
            }
        }
    }

    return {
        rightElbowAngle: angle(wl[12], wl[14], wl[16]),
        leftElbowAngle: angle(wl[11], wl[13], wl[15]),
        rightShoulderAngle: angle(wl[24], wl[12], wl[14]),
        leftShoulderAngle: angle(wl[23], wl[11], wl[13]),
        rightWristRelX: (wl[16]?.x || 0) - shoulderCenterX,
        rightWristRelY: (wl[16]?.y || 0) - shoulderCenterY,
        rightWristRelZ: (wl[16]?.z || 0) - shoulderCenterZ,
        leftWristRelX: (wl[15]?.x || 0) - shoulderCenterX,
        leftWristRelY: (wl[15]?.y || 0) - shoulderCenterY,
        leftWristRelZ: (wl[15]?.z || 0) - shoulderCenterZ,
        trunkRotation,
        rightKneeAngle: angle(wl[24], wl[26], wl[28]),
        leftKneeAngle: angle(wl[23], wl[25], wl[27]),
        bodyLeanX: shoulderCenterX - hipCenterX,
        bodyLeanZ: shoulderCenterZ - hipCenterZ,
        rightWristVelocity: rightWristVel,
        leftWristVelocity: leftWristVel,
    };
}
