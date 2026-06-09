/**
 * Matterport → MultiSet: **x′ = x, y′ = y, z′ = −z** (Matterport frame → MultiSet VPS).
 *
 * Floor colorplan (px, py) is treated as horizontal **MP.x** and **MP.z** (Y vertical in MP).
 * So MS.x = px, MS.z = −py (since MS.z = −MP.z). MS.y is unchanged on floor drag (height).
 */

/**
 * Full 3D: Matterport (x,y,z) → MultiSet VPS.
 * @param {number} mpX
 * @param {number} mpY
 * @param {number} mpZ
 */
export function multisetFromMatterport3d(mpX, mpY, mpZ) {
  return { x: mpX, y: mpY, z: -mpZ };
}

/**
 * Inverse: MultiSet → Matterport 3D.
 */
export function matterport3dFromMultiset(msX, msY, msZ) {
  return { x: msX, y: msY, z: -msZ };
}

/**
 * Horizontal floor plan: px = MP.x, py = MP.z (second horizontal on colorplan).
 * @param {number} px Matterport floor x (= MP.x)
 * @param {number} py Matterport floor y on plan (= MP.z)
 * @param {number} msY MultiSet Y (unchanged on drag)
 */
export function multisetFromMatterportFloor(px, py, msY) {
  return {
    x: px,
    y: msY,
    z: -py,
  };
}

/**
 * @param {number} sx MultiSet x (= MP.x)
 * @param {number} sz MultiSet z; MS.z = −MP.z ⇒ MP.z = −sz, i.e. colorplan py = −sz
 * @returns {{ px: number, py: number }}
 */
export function matterportFloorFromMultiset(sx, sz) {
  return { px: sx, py: -sz };
}
