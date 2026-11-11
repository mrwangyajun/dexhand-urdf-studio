/**
 * 惯量相关的数学处理
 * URDF 的 <inertia> 必须相对「质心」且为 SI（kg·m^2）
 */

/** 对称 3x3 矩阵，行主序 */
export function inertiaMatrix(i) {
  return [
    [i.ixx, i.ixy, i.ixz],
    [i.ixy, i.iyy, i.iyz],
    [i.ixz, i.iyz, i.izz]
  ]
}

/**
 * 把「相对输出坐标系（link 原点）」的惯量换算到质心
 * I_O = I_C + m (|d|^2 E - d d^T)  =>  I_C = I_O - m(|d|^2 E - d d^T)
 */
export function inertiaToCom(inertia, frame, mass, com) {
  if (!inertia) return null
  const base = {
    ixx: Number(inertia.ixx) || 0,
    ixy: Number(inertia.ixy) || 0,
    ixz: Number(inertia.ixz) || 0,
    iyy: Number(inertia.iyy) || 0,
    iyz: Number(inertia.iyz) || 0,
    izz: Number(inertia.izz) || 0
  }
  if (frame !== 'output') return base
  const m = Number(mass) || 0
  const x = Number(com?.x) || 0
  const y = Number(com?.y) || 0
  const z = Number(com?.z) || 0
  return {
    ixx: base.ixx - m * (y * y + z * z),
    iyy: base.iyy - m * (x * x + z * z),
    izz: base.izz - m * (x * x + y * y),
    ixy: base.ixy + m * x * y,
    ixz: base.ixz + m * x * z,
    iyz: base.iyz + m * y * z
  }
}

/** 半正定检查（Sylvester 判据） */
export function isPositiveDefinite(i) {
  if (!i) return false
  const eps = 1e-15
  if (!(i.ixx > eps) || !(i.iyy > eps) || !(i.izz > eps)) return false
  const d2 = i.ixx * i.iyy - i.ixy * i.ixy
  if (!(d2 > 0)) return false
  const det =
    i.ixx * (i.iyy * i.izz - i.iyz * i.iyz) -
    i.ixy * (i.ixy * i.izz - i.iyz * i.ixz) +
    i.ixz * (i.ixy * i.iyz - i.iyy * i.ixz)
  return det > 0
}

/** 三角不等式（真实刚体必然满足 ixx <= iyy+izz 等） */
export function triangleInequalityOk(i) {
  if (!i) return true
  const tol = 1e-9 * Math.max(1, Math.abs(i.ixx) + Math.abs(i.iyy) + Math.abs(i.izz))
  return (
    i.ixx <= i.iyy + i.izz + tol &&
    i.iyy <= i.ixx + i.izz + tol &&
    i.izz <= i.ixx + i.iyy + tol
  )
}

/** 惯量随质量缩放（占位值时使用） */
export function scaleInertia(inertia, k) {
  const f = Number(k) || 1
  return {
    ixx: (inertia?.ixx || 0) * f,
    ixy: (inertia?.ixy || 0) * f,
    ixz: (inertia?.ixz || 0) * f,
    iyy: (inertia?.iyy || 0) * f,
    iyz: (inertia?.iyz || 0) * f,
    izz: (inertia?.izz || 0) * f
  }
}

/** 由长方体尺寸与质量估算惯量（在质心、坐标轴对齐） —— 仅用于占位值 */
export function boxInertia(mass, sx, sy, sz) {
  const m = Number(mass) || 0
  return {
    ixx: (m / 12) * (sy * sy + sz * sz),
    iyy: (m / 12) * (sx * sx + sz * sz),
    izz: (m / 12) * (sx * sx + sy * sy),
    ixy: 0,
    ixz: 0,
    iyz: 0
  }
}
