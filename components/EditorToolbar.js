// file: components/EditorToolbar.js
'use client';

import { useEffect, useRef, useState } from 'react';

export default function EditorToolbar({
  currentTool,
  setTool,
  selectMode,
  setSelectMode,

  // ✅ file
  onFileSave,
  onFileOpen,

  onAddCube,
  onAddBox,
  onAddCylinder,
  onAddCone,

  onDeleteSelected,
  canDelete,

  onResetLayout,
  leftVisible,
  rightVisible,
  onToggleLeft,
  onToggleRight,

  onGroupSelected,
  onUngroupSelected,
  onFuseSelected,
  canGroup,
  canUngroup,
  canFuse,

  showShadows,
  showGrid,
  onToggleShadows,
  onToggleGrid,

  onOpenSteelPanel,

  // ✅ 追加：2D作図 / 立体化
  onStartSketch2D,
  onStartExtrude,
}) {
  const [openFile, setOpenFile] = useState(false);
  const [openView, setOpenView] = useState(false);
  const [openDup, setOpenDup] = useState(false);

  const fileWrapRef = useRef(null);
  const viewWrapRef = useRef(null);
  const dupWrapRef = useRef(null);

  useEffect(() => {
    const onDown = (e) => {
      if (openFile && fileWrapRef.current && !fileWrapRef.current.contains(e.target)) setOpenFile(false);
      if (openView && viewWrapRef.current && !viewWrapRef.current.contains(e.target)) setOpenView(false);
      if (openDup && dupWrapRef.current && !dupWrapRef.current.contains(e.target)) setOpenDup(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [openFile, openView, openDup]);

  const Btn = ({ active, onClick, children, title, disabled }) => (
    <button
      className={[
        'border px-2 py-1 text-xs transition',
        'hover:bg-gray-50',
        active ? 'bg-orange-500 text-white border-orange-600 ring-2 ring-orange-300' : 'bg-white',
        disabled ? 'opacity-40 cursor-not-allowed' : '',
      ].join(' ')}
      onClick={() => {
        if (disabled) return;
        onClick?.();
      }}
      title={title}
      type="button"
    >
      {children}
    </button>
  );

  const isDupTool = currentTool === 'dup-translate' || currentTool === 'dup-rotate' || currentTool === 'dup-mirror';

  return (
    <div className="w-full border-b bg-white">
      <div className="flex items-center gap-2 px-2 py-1 text-xs">
        {/* ✅ ファイル */}
        <div className="relative" ref={fileWrapRef}>
          <button
            className="border px-2 py-1 hover:bg-gray-50"
            type="button"
            onClick={() => {
              setOpenFile((v) => !v);
              setOpenView(false);
              setOpenDup(false);
            }}
          >
            ファイル ▾
          </button>

          {openFile ? (
            <div className="absolute left-0 top-full z-50 mt-1 w-40 border bg-white shadow">
              <button
                className="w-full px-3 py-2 text-left text-xs hover:bg-gray-50"
                type="button"
                onClick={() => {
                  onFileSave?.();
                  setOpenFile(false);
                }}
              >
                保存
              </button>
              <button
                className="w-full px-3 py-2 text-left text-xs hover:bg-gray-50"
                type="button"
                onClick={() => {
                  onFileOpen?.();
                  setOpenFile(false);
                }}
              >
                開く
              </button>
            </div>
          ) : null}
        </div>

        <button className="border px-2 py-1 hover:bg-gray-50" type="button">
          編集
        </button>

        {/* ✅ 表示 */}
        <div className="relative" ref={viewWrapRef}>
          <button
            className="border px-2 py-1 hover:bg-gray-50"
            type="button"
            onClick={() => {
              setOpenView((v) => !v);
              setOpenFile(false);
              setOpenDup(false);
            }}
          >
            表示 ▾
          </button>

          {openView ? (
            <div className="absolute left-0 top-full z-50 mt-1 w-64 border bg-white shadow">
              <button
                className="w-full px-3 py-2 text-left text-xs hover:bg-gray-50"
                type="button"
                onClick={() => {
                  onToggleLeft?.();
                  setOpenView(false);
                }}
              >
                {leftVisible ? '左パネルを非表示' : '左パネルを表示'}
              </button>
              <button
                className="w-full px-3 py-2 text-left text-xs hover:bg-gray-50"
                type="button"
                onClick={() => {
                  onToggleRight?.();
                  setOpenView(false);
                }}
              >
                {rightVisible ? '右パネルを非表示' : '右パネルを表示'}
              </button>

              <div className="my-1 border-t" />

              <button
                className="w-full px-3 py-2 text-left text-xs hover:bg-gray-50"
                type="button"
                onClick={() => onToggleShadows?.()}
              >
                {showShadows ? '☑' : '☐'} 影（Shadow）
              </button>
              <button className="w-full px-3 py-2 text-left text-xs hover:bg-gray-50" type="button" onClick={() => onToggleGrid?.()}>
                {showGrid ? '☑' : '☐'} グリッド線
              </button>

              <div className="my-1 border-t" />

              <button
                className="w-full px-3 py-2 text-left text-xs hover:bg-gray-50"
                type="button"
                onClick={() => {
                  onResetLayout?.();
                  setOpenView(false);
                }}
              >
                幅を初期に戻す
              </button>
            </div>
          ) : null}
        </div>

        <button className="border px-2 py-1 hover:bg-gray-50" type="button">
          設定
        </button>
        <button className="border px-2 py-1 hover:bg-gray-50" type="button">
          ツール
        </button>
        <button className="border px-2 py-1 hover:bg-gray-50" type="button">
          ヘルプ
        </button>

        <div className="ml-auto text-xs text-gray-600">Tool: {currentTool}</div>
      </div>

      <div className="flex flex-wrap items-center gap-1 px-2 py-1">
        <Btn active={currentTool === 'select'} onClick={() => setTool('select')}>
          選択
        </Btn>
        <Btn active={currentTool === 'pan'} onClick={() => setTool('pan')} title="複数をまとめて移動">
          平行移動
        </Btn>
        <Btn active={currentTool === 'rotate'} onClick={() => setTool('rotate')} title="軸と角度で回転">
          回転
        </Btn>

        <div className="relative" ref={dupWrapRef}>
          <Btn
            active={isDupTool}
            onClick={() => {
              setOpenDup((v) => !v);
              setOpenFile(false);
              setOpenView(false);
            }}
            title="複製（平行 / 回転 / ミラー）"
          >
            複製 ▾
          </Btn>

          {openDup ? (
            <div className="absolute left-0 top-full z-50 mt-1 w-40 border bg-white shadow">
              <button
                className="w-full px-3 py-2 text-left text-xs hover:bg-gray-50"
                type="button"
                onClick={() => {
                  setTool('dup-translate');
                  setOpenDup(false);
                }}
              >
                平行複製
              </button>
              <button
                className="w-full px-3 py-2 text-left text-xs hover:bg-gray-50"
                type="button"
                onClick={() => {
                  setTool('dup-rotate');
                  setOpenDup(false);
                }}
              >
                回転複製
              </button>
              <button
                className="w-full px-3 py-2 text-left text-xs hover:bg-gray-50"
                type="button"
                onClick={() => {
                  setTool('dup-mirror');
                  setOpenDup(false);
                }}
              >
                ミラー複製
              </button>
            </div>
          ) : null}
        </div>

        <span className="mx-1 text-xs text-gray-500">|</span>

        <Btn onClick={() => onOpenSteelPanel?.()} title="鋼材（チャンネル / Lアングル）を追加">
          鋼材追加
        </Btn>

        <span className="mx-1 text-xs text-gray-500">|</span>

        <Btn onClick={onAddCube} title="サイズ指定してから配置（mm）">
          立方体
        </Btn>
        <Btn onClick={onAddBox} title="サイズ指定してから配置（mm）">
          直方体
        </Btn>
        <Btn onClick={onAddCylinder} title="サイズ指定してから配置（mm）">
          円柱
        </Btn>
        <Btn onClick={onAddCone} title="サイズ指定してから配置（mm）">
          円錐
        </Btn>

        <span className="mx-1 text-xs text-gray-500">|</span>

        <Btn
          active={selectMode === 'body'}
          onClick={() => {
            setTool('select');
            setSelectMode?.('body');
          }}
          title="立体そのものを選択"
        >
          立体モード
        </Btn>
        <Btn
          active={selectMode === 'vertex'}
          onClick={() => {
            setTool('select');
            setSelectMode?.('vertex');
          }}
          title="頂点/中点を表示して原点を設定"
        >
          頂点モード
        </Btn>

        <Btn active={currentTool === 'vertex-move'} onClick={() => setTool('vertex-move')} title="頂点移動">
          頂点移動
        </Btn>

        <span className="mx-1 text-xs text-gray-500">|</span>

        <Btn
          active={currentTool === 'sketch2d'}
          onClick={() => {
            setTool('sketch2d');
            onStartSketch2D?.();
          }}
          title="面をクリックして2D作図を開始"
        >
          2D作図
        </Btn>

        <Btn
          active={currentTool === 'extrude'}
          onClick={() => {
            setTool('extrude');
            onStartExtrude?.();
          }}
          title="面をクリック→閉じた輪郭を選んで押し出し"
        >
          立体化
        </Btn>

        <span className="mx-1 text-xs text-gray-500">|</span>

        <Btn onClick={onGroupSelected} disabled={!canGroup} title="複数選択を1つのグループにまとめる">
          グループ化
        </Btn>
        <Btn onClick={onFuseSelected} disabled={!canFuse} title="選択物を1つの図形として融合（結合メッシュ）">
          融合
        </Btn>
        <Btn onClick={onUngroupSelected} disabled={!canUngroup} title="グループ化を解除（分解）">
          分解
        </Btn>

        <span className="mx-1 text-xs text-gray-500">|</span>

        <Btn onClick={() => onDeleteSelected?.()} title="Deleteキーでも削除" disabled={!canDelete}>
          削除
        </Btn>
      </div>
    </div>
  );
}