import React from 'react'
import { downloadText } from '../core/project.js'

export default function Drawer({ tab, onTab, urdfText, validation, onSelect, open, onToggle, robotName }) {
  const errors = validation.items.filter((i) => i.level === 'error')
  const warns = validation.items.filter((i) => i.level === 'warn')
  const infos = validation.items.filter((i) => i.level === 'info')

  return (
    <div className={`drawer ${open ? 'open' : ''}`}>
      <div className="drawer-tabs">
        <button className={tab === 'urdf' ? 'on' : ''} onClick={() => onTab('urdf')}>
          URDF 预览
        </button>
        <button className={tab === 'check' ? 'on' : ''} onClick={() => onTab('check')}>
          校验
          {errors.length ? <span className="tab-dot err">{errors.length}</span> : null}
          {!errors.length && warns.length ? <span className="tab-dot warn">{warns.length}</span> : null}
        </button>
        <button className={tab === 'help' ? 'on' : ''} onClick={() => onTab('help')}>
          说明
        </button>
        <div className="spacer" />
        {tab === 'urdf' ? (
          <button
            className="mini"
            onClick={() => downloadText(`${robotName || 'robot'}.urdf`, urdfText, 'application/xml')}
          >
            下载 .urdf
          </button>
        ) : null}
        <button className="icon-btn" onClick={onToggle} title={open ? '收起' : '展开'}>
          {open ? '▾' : '▴'}
        </button>
      </div>

      {open ? (
        <div className="drawer-body">
          {tab === 'urdf' ? (
            <pre className="code">{urdfText}</pre>
          ) : tab === 'check' ? (
            <div className="check-list">
              {!validation.items.length ? (
                <div className="check-empty">✓ 没有发现问题，可以导出</div>
              ) : null}
              {[...errors, ...warns, ...infos].map((it, idx) => (
                <div
                  key={`${it.code}_${idx}`}
                  className={`check-item lv-${it.level}`}
                  onClick={() => {
                    if (it.linkId) onSelect({ type: 'link', id: it.linkId })
                    else if (it.jointId) onSelect({ type: 'joint', id: it.jointId })
                  }}
                >
                  <span className="lv">{it.level === 'error' ? '错误' : it.level === 'warn' ? '警告' : '提示'}</span>
                  <span className="msg">{it.message}</span>
                  {it.linkId || it.jointId ? <span className="goto">定位 →</span> : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="help">
              <h4>推荐工作流</h4>
              <ol>
                <li>
                  在 SolidWorks 里为每个零件建好<strong>关节坐标系</strong>（原点在转轴 + 轴向对齐某一坐标轴），
                  用「质量属性」导出参数，零件另存为 STL（建议 mm）。
                </li>
                <li>左侧上传网格 → 每个文件成为一个 link。</li>
                <li>用「导入质量属性」把 TXT/CSV/复制文本填进对应 link（识别不了就手填）。</li>
                <li>在装配树里逐个「建关节」：parent、child、origin、axis、limit。</li>
                <li>看下方校验，把错误清零后导出 zip，用 README 里的命令在 ROS 2 / MuJoCo / Isaac 里验证。</li>
              </ol>
              <h4>单位约定</h4>
              <p>
                内部与导出统一 <code>m / kg / rad / kg·m²</code>。面板上的单位下拉只影响输入显示；
                网格若是 mm，会在 <code>&lt;mesh scale&gt;</code> 里写 0.001。
              </p>
              <h4>惯量参考系</h4>
              <p>
                URDF 的 <code>&lt;inertia&gt;</code> 必须相对质心。若你填的是「相对输出坐标系」，
                导出时会自动用平行轴定理换算，换算结果显示在面板里。
              </p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
