// @ts-check
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

const rootDir = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

const vsixName = `${pkg.name}-${pkg.version}.vsix`;
const vsixPath = path.join(rootDir, vsixName);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsix-build-'));
const extDir = path.join(tmpDir, 'extension');
fs.mkdirSync(extDir, { recursive: true });

// Copy extension files
const filesToCopy = [
  'package.json',
  'package.nls.json',
  'package.nls.zh-cn.json',
  'README.md',
  'LICENSE',
  'src',
  'img'
];

for (const item of filesToCopy) {
  const srcPath = path.join(rootDir, item);
  if (fs.existsSync(srcPath)) {
    fs.cpSync(srcPath, path.join(extDir, item), { recursive: true });
  }
}

// Create [Content_Types].xml
const contentTypesXml = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json"/>
  <Default Extension=".js" ContentType="application/javascript"/>
  <Default Extension=".md" ContentType="text/markdown"/>
  <Default Extension=".png" ContentType="image/png"/>
  <Default Extension=".txt" ContentType="text/plain"/>
  <Default Extension=".vsixmanifest" ContentType="text/xml"/>
</Types>
`;
fs.writeFileSync(path.join(tmpDir, '[Content_Types].xml'), contentTypesXml, 'utf8');

// Create extension.vsixmanifest
const vsixManifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${pkg.name}" Version="${pkg.version}" Publisher="${pkg.publisher}" />
    <DisplayName>Antigravity Helper</DisplayName>
    <Description xml:space="preserve">Enhance Google Antigravity in VS Code: right-click files/folders to chat, right-click editor selections to chat, and drag-and-drop files directly into the chat window.</Description>
    <Tags>${(pkg.keywords || []).join(',')}</Tags>
    <Categories>${(pkg.categories || []).join(',')}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${pkg.engines.vscode}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="ui,workspace" />
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="" />
      <Property Id="Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown" Value="true" />
    </Properties>
    <License>extension/LICENSE</License>
    <Icon>extension/img/icon.png</Icon>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/img/icon.png" Addressable="true" />
  </Assets>
</PackageManifest>
`;
fs.writeFileSync(path.join(tmpDir, 'extension.vsixmanifest'), vsixManifest, 'utf8');

if (fs.existsSync(vsixPath)) {
  fs.unlinkSync(vsixPath);
}

execFileSync('zip', ['-r', vsixPath, '[Content_Types].xml', 'extension.vsixmanifest', 'extension'], {
  cwd: tmpDir,
  stdio: 'inherit'
});

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log(`Successfully packaged: ${vsixPath}`);
