/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/connectionBrowseTab';
import { IPanelTab, IPanelView } from 'sql/base/browser/ui/panel/panel';
import { ITreeItem } from 'sql/workbench/common/views';
import { IConnectionTreeDescriptor, IConnectionTreeService } from 'sql/workbench/services/connection/common/connectionTreeService';
import * as DOM from 'vs/base/browser/dom';
import { IIdentityProvider, IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';
import { IAsyncDataSource, ITreeMouseEvent, ITreeNode, ITreeRenderer } from 'vs/base/browser/ui/tree/tree';
import { Iterable } from 'vs/base/common/iterator';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { basename, dirname } from 'vs/base/common/resources';
import { isString } from 'vs/base/common/types';
import { URI } from 'vs/base/common/uri';
import { localize } from 'vs/nls';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { FileKind } from 'vs/platform/files/common/files';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILabelService } from 'vs/platform/label/common/label';
import { WorkbenchAsyncDataTree } from 'vs/platform/list/browser/listService';
import { FileThemeIcon, FolderThemeIcon, IThemeService, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { IResourceLabel, ResourceLabels } from 'vs/workbench/browser/labels';
import { ITreeItemLabel, ITreeViewDataProvider, TreeItemCollapsibleState, TreeViewItemHandleArg } from 'vs/workbench/common/views';
import { Emitter, Event } from 'vs/base/common/event';
import { AsyncRecentConnectionTreeDataSource } from 'sql/workbench/services/objectExplorer/browser/asyncRecentConnectionTreeDataSource';
import { IConnectionManagementService } from 'sql/platform/connection/common/connectionManagement';
import { TreeUpdateUtils } from 'sql/workbench/services/objectExplorer/browser/treeUpdateUtils';
import { ServerTreeElement } from 'sql/workbench/services/objectExplorer/browser/asyncServerTree';
import { ConnectionProfile } from 'sql/platform/connection/common/connectionProfile';
import { ConnectionProfileGroup } from 'sql/platform/connection/common/connectionProfileGroup';
import { TreeNode } from 'sql/workbench/services/objectExplorer/common/treeNode';
import { ServerTreeRenderer } from 'sql/workbench/services/objectExplorer/browser/serverTreeRenderer';
import { ConnectionProfileGroupRenderer, ConnectionProfileRenderer, TreeNodeRenderer } from 'sql/workbench/services/objectExplorer/browser/asyncServerTreeRenderer';
import { ColorScheme } from 'vs/platform/theme/common/theme';
import { InputBox } from 'sql/base/browser/ui/inputBox/inputBox';
import { IContextMenuService, IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { attachInputBoxStyler } from 'sql/platform/theme/common/styler';
import { debounce } from 'vs/base/common/decorators';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IMenuService, MenuId } from 'vs/platform/actions/common/actions';
import { IContextKey, IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IAction } from 'vs/base/common/actions';
import { createAndFillInContextMenuActions } from 'vs/platform/actions/browser/menuEntryActionViewItem';

export type TreeElement = ConnectionProviderElement | ITreeItemFromProvider | SavedConnectionNode | ServerTreeElement;

export class ConnectionBrowseTab implements IPanelTab {
	public readonly title = localize('connectionDialog.browser', "Browse");
	public readonly identifier = 'connectionBrowse';
	public readonly view = this.instantiationService.createInstance(ConnectionBrowserView);
	constructor(@IInstantiationService private readonly instantiationService: IInstantiationService) { }
}

export class ConnectionBrowserView extends Disposable implements IPanelView {
	private tree: WorkbenchAsyncDataTree<TreeModel, TreeElement> | undefined;
	private filterInput: InputBox | undefined;
	private treeContainer: HTMLElement | undefined;
	private model: TreeModel | undefined;
	private treeLabels: ResourceLabels | undefined;
	private treeDataSource: DataSource | undefined;
	private readonly contextKey = new ContextKey(this.contextKeyService);

	public onDidChangeVisibility = Event.None;

	private readonly _onSelect = this._register(new Emitter<ITreeMouseEvent<TreeElement>>());
	public readonly onSelect = this._onSelect.event;

	private readonly _onDblClick = this._register(new Emitter<ITreeMouseEvent<TreeElement>>());
	public readonly onDblClick = this._onDblClick.event;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IConnectionTreeService private readonly connectionTreeService: IConnectionTreeService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IThemeService private readonly themeService: IThemeService,
		@ICommandService private readonly commandService: ICommandService,
		@IMenuService private readonly menuService: IMenuService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService
	) {
		super();
		this.connectionTreeService.setView(this);
	}

	render(container: HTMLElement): void {
		this.renderFilterBox(container);
		this.renderTree(container);
	}

	renderFilterBox(container: HTMLElement): void {
		this.filterInput = new InputBox(container, this.contextViewService, {
			placeholder: localize('connectionDialog.FilterPlaceHolder', "Type here to filter the list"),
			ariaLabel: localize('connectionDialog.FilterInputTitle', "Filter connections")
		});
		this.filterInput.element.style.margin = '5px';
		this._register(this.filterInput);
		this._register(attachInputBoxStyler(this.filterInput, this.themeService));
		this._register(this.filterInput.onDidChange(async () => {
			await this.applyFilter();
		}));
	}

	@debounce(500)
	async applyFilter(): Promise<void> {
		this.treeDataSource.setFilter(this.filterInput.value);
		await this.refresh();
		await this.expandAll();
	}

	async expandAll(): Promise<void> {
		const expandedTreeItems: TreeElement[] = [];
		let treeItemsToExpand: TreeElement[] = this.treeDataSource.expandableTreeNodes;
		// expand the nodes one by one here to avoid the possible azure api traffic throttling.
		while (treeItemsToExpand.length !== 0) {
			for (const treeItem of treeItemsToExpand) {
				await this.tree.expand(treeItem);
			}
			expandedTreeItems.push(...treeItemsToExpand);
			treeItemsToExpand = this.treeDataSource.expandableTreeNodes.filter(el => expandedTreeItems.indexOf(el) === -1);
		}
	}

	renderTree(container: HTMLElement): void {
		this.treeContainer = container.appendChild(DOM.$('div'));
		this.treeLabels = this._register(this.instantiationService.createInstance(ResourceLabels, this));
		const renderers: ITreeRenderer<TreeElement, any, any>[] = [
			new ProviderElementRenderer(),
			this.instantiationService.createInstance(TreeItemRenderer, this.treeLabels),
			this.instantiationService.createInstance(ConnectionProfileRenderer, true),
			this.instantiationService.createInstance(ConnectionProfileGroupRenderer),
			this.instantiationService.createInstance(TreeNodeRenderer),
			new SavedConnectionsNodeRenderer()
		];

		this.model = this.instantiationService.createInstance(TreeModel);
		this.treeDataSource = new DataSource();
		this.tree = this._register(this.instantiationService.createInstance(
			WorkbenchAsyncDataTree,
			'Browser Connections',
			this.treeContainer,
			new ListDelegate(),
			renderers,
			this.treeDataSource,
			{
				identityProvider: new IdentityProvider(),
				horizontalScrolling: false,
				setRowLineHeight: false,
				transformOptimization: false,
				accessibilityProvider: new ListAccessibilityProvider()
			}) as WorkbenchAsyncDataTree<TreeModel, TreeElement>);
		this._register(this.tree.onContextMenu(e => {
			const context = e.element as ITreeItemFromProvider;
			if (context?.element) {
				this.contextKey.set(context.element);
				const menu = this.menuService.createMenu(MenuId.ConnectionDialogBrowseTreeContext, this.contextKeyService);
				const primary: IAction[] = [];
				const secondary: IAction[] = [];
				const result = { primary, secondary };
				createAndFillInContextMenuActions(menu, { shouldForwardArgs: true }, result, this.contextMenuService);

				this.contextMenuService.showContextMenu({
					getAnchor: () => e.anchor,
					getActions: () => result.primary,
					getActionsContext: () => (<TreeViewItemHandleArg>{ $treeViewId: context.treeId, $treeItemHandle: context.element.handle, $treeItem: context.element })
				});
			}
		}));
		this._register(this.tree.onMouseDblClick(e => this._onDblClick.fire(e)));
		this._register(this.tree.onMouseClick(e => this._onSelect.fire(e)));
		this._register(this.tree.onDidOpen((e) => {
			if (!e.browserEvent) {
				return;
			}
			const selection = this.tree.getSelection();
			if (selection.length === 1) {
				const selectedNode = selection[0];
				if ('element' in selectedNode && selectedNode.element.command) {
					this.commandService.executeCommand(selectedNode.element.command.id, ...(selectedNode.element.command.arguments || []));
				}
			}
		}));

		this.tree.setInput(this.model);

		this._register(this.connectionTreeService.onDidAddProvider(() => this.tree.updateChildren(this.model)));
	}

	async refresh(items?: ITreeItem[]): Promise<void> {
		if (this.tree) {
			return this.tree.updateChildren();
		}
	}

	layout(dimension: DOM.Dimension): void {
		const treeHeight = dimension.height - DOM.getTotalHeight(this.filterInput.element);
		this.treeContainer.style.width = `${dimension.width}px`;
		this.treeContainer.style.height = `${treeHeight}px`;
		this.tree.layout(treeHeight, dimension.width);
	}

	focus(): void {
		this.tree.domFocus();
	}
}

export interface ITreeItemFromProvider {
	readonly element: ITreeItem;
	readonly treeId?: string;
	getChildren?(): Promise<ITreeItemFromProvider[]>
}

class ConnectionProviderElement {
	public readonly id = this.descriptor.id;
	public readonly name = this.descriptor.name;

	constructor(private readonly provider: ITreeViewDataProvider, private readonly descriptor: IConnectionTreeDescriptor) {
	}

	async getChildren(element?: ITreeItem): Promise<ITreeItemFromProvider[]> {
		const children = await this.provider.getChildren(element);
		return children.map(v => ({
			element: v,
			treeId: this.descriptor.id,
			getChildren: () => this.getChildren(v)
		}));
	}
}

class ListDelegate implements IListVirtualDelegate<TreeElement> {
	getHeight(): number {
		return 22;
	}

	getTemplateId(element: TreeElement): string {
		if (element instanceof ConnectionProviderElement) {
			return ProviderElementRenderer.TEMPLATE_ID;
		} else if (element instanceof ConnectionProfile) {
			return ServerTreeRenderer.CONNECTION_TEMPLATE_ID;
		} else if (element instanceof ConnectionProfileGroup) {
			return ServerTreeRenderer.CONNECTION_GROUP_TEMPLATE_ID;
		} else if (element instanceof TreeNode) {
			return ServerTreeRenderer.OBJECTEXPLORER_TEMPLATE_ID;
		} else if (element instanceof SavedConnectionNode) {
			return SavedConnectionsNodeRenderer.TEMPLATE_ID;
		} else {
			return TreeItemRenderer.TREE_TEMPLATE_ID;
		}
	}
}

interface ProviderElementTemplate {
	readonly icon: HTMLElement;
	readonly name: HTMLElement;
}

class ProviderElementRenderer implements ITreeRenderer<ConnectionProviderElement, void, ProviderElementTemplate> {
	public static readonly TEMPLATE_ID = 'ProviderElementTemplate';
	public readonly templateId = ProviderElementRenderer.TEMPLATE_ID;

	renderTemplate(container: HTMLElement): ProviderElementTemplate {
		const icon = DOM.append(container, DOM.$('.icon'));
		const name = DOM.append(container, DOM.$('.name'));
		return { name, icon };
	}

	renderElement(element: ITreeNode<ConnectionProviderElement, void>, index: number, templateData: ProviderElementTemplate, height: number): void {
		templateData.name.innerText = element.element.name;
	}

	disposeTemplate(templateData: ProviderElementTemplate): void {
	}
}

interface SavedConnectionNodeElementTemplate {
	readonly icon: HTMLElement;
	readonly name: HTMLElement;
}

class SavedConnectionsNodeRenderer implements ITreeRenderer<ConnectionProviderElement, void, SavedConnectionNodeElementTemplate> {
	public static readonly TEMPLATE_ID = 'savedConnectionNode';
	public readonly templateId = SavedConnectionsNodeRenderer.TEMPLATE_ID;

	renderTemplate(container: HTMLElement): SavedConnectionNodeElementTemplate {
		const icon = DOM.append(container, DOM.$('.icon'));
		const name = DOM.append(container, DOM.$('.name'));
		return { name, icon };
	}

	renderElement(element: ITreeNode<ConnectionProviderElement, void>, index: number, templateData: SavedConnectionNodeElementTemplate, height: number): void {
		templateData.name.innerText = localize('savedConnections', "Saved Connections");
	}

	disposeTemplate(templateData: SavedConnectionNodeElementTemplate): void {
	}
}

class IdentityProvider implements IIdentityProvider<TreeElement> {
	getId(element: TreeElement): string {
		if (element instanceof ConnectionProviderElement) {
			return element.id;
		} else if (element instanceof ConnectionProfile) {
			return element.id;
		} else if (element instanceof ConnectionProfileGroup) {
			return element.id!;
		} else if (element instanceof TreeNode) {
			return element.id;
		} else if (element instanceof SavedConnectionNode) {
			return element.id;
		} else {
			return element.element.handle;
		}
	}
}

class TreeModel {

	constructor(
		@IConnectionTreeService private readonly connectionTreeService: IConnectionTreeService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) { }

	getChildren(): TreeElement[] {
		const descriptors = Array.from(this.connectionTreeService.descriptors);
		return [this.instantiationService.createInstance(SavedConnectionNode), ...Iterable.map(this.connectionTreeService.providers, ([id, provider]) => new ConnectionProviderElement(provider, descriptors.find(i => i.id === id)))];
	}
}

class ListAccessibilityProvider implements IListAccessibilityProvider<TreeElement> {
	getAriaLabel(element: TreeElement): string {
		if (element instanceof ConnectionProviderElement) {
			return element.name;
		} else if (element instanceof ConnectionProfile) {
			return element.serverName;
		} else if (element instanceof ConnectionProfileGroup) {
			return element.name;
		} else if (element instanceof TreeNode) {
			return element.label;
		} else if (element instanceof SavedConnectionNode) {
			return localize('savedConnection', "Saved Connections");
		} else {
			return element.element.handle;
		}
	}

	getWidgetAriaLabel(): string {
		return localize('connectionBrowserTree', "Connection Browser Tree");
	}
}

class DataSource implements IAsyncDataSource<TreeModel, TreeElement> {
	private _filter: string | undefined;
	private _filterRegex: RegExp | undefined;
	public setFilter(filter: string): void {
		this._filter = filter;
		this._filterRegex = new RegExp(filter, 'i');
	}

	hasChildren(element: TreeModel | TreeElement): boolean {
		if (element instanceof TreeModel) {
			return true;
		} else if (element instanceof ConnectionProviderElement) {
			return true;
		} else if (element instanceof ConnectionProfile) {
			return false;
		} else if (element instanceof ConnectionProfileGroup) {
			return element.hasChildren();
		} else if (element instanceof TreeNode) {
			return element.children.length > 0;
		} else if (element instanceof SavedConnectionNode) {
			return true;
		} else {
			return element.element.collapsibleState !== TreeItemCollapsibleState.None;
		}
	}

	public treeNodes: TreeElement[] = [];

	public get expandableTreeNodes(): TreeElement[] {
		return this.treeNodes.filter(node => {
			return node instanceof TreeModel
				|| node instanceof SavedConnectionNode
				|| node instanceof ConnectionProfileGroup
				|| node instanceof TreeNode
				|| node instanceof ConnectionProviderElement
				|| (!(node instanceof ConnectionProfile) && node.element.collapsibleState !== TreeItemCollapsibleState.None);
		});
	}

	async getChildren(element: TreeModel | TreeElement): Promise<Iterable<TreeElement>> {
		if (element instanceof TreeModel) {
			this.treeNodes = [];
		}
		if (!(element instanceof ConnectionProfile)) {
			let children = await element.getChildren();
			if (this._filter) {
				if ((element instanceof SavedConnectionNode) || (element instanceof ConnectionProfileGroup)) {
					children = (children as (ConnectionProfile | ConnectionProfileGroup)[]).filter(item => {
						return (item instanceof ConnectionProfileGroup) || this._filterRegex.test(item.title);
					});
				} else if (
					!(element instanceof TreeModel) &&
					!(element instanceof TreeNode) &&
					!(element instanceof ConnectionProviderElement)
				) {
					children = (children as ITreeItemFromProvider[]).filter(item => {
						return item.element.collapsibleState !== TreeItemCollapsibleState.None || this._filterRegex.test(item.element.label.label);
					});
				}
			}
			this.treeNodes.push(...children);
			return children;
		}
		return [];
	}
}

class SavedConnectionNode {
	public readonly id = 'SavedConnectionNode';
	private readonly dataSource: AsyncRecentConnectionTreeDataSource;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IConnectionManagementService private readonly connectionManagementService: IConnectionManagementService
	) {
		this.dataSource = instantiationService.createInstance(AsyncRecentConnectionTreeDataSource);
	}

	getChildren() {
		return this.dataSource.getChildren(TreeUpdateUtils.getTreeInput(this.connectionManagementService));
	}
}

interface ITreeExplorerTemplateData {
	elementDisposable: IDisposable;
	container: HTMLElement;
	resourceLabel: IResourceLabel;
	icon: HTMLElement;
	// actionBar: ActionBar;
}

class TreeItemRenderer extends Disposable implements ITreeRenderer<ITreeItemFromProvider, void, ITreeExplorerTemplateData> {
	static readonly ITEM_HEIGHT = 22;
	static readonly TREE_TEMPLATE_ID = 'treeExplorer';

	// private _actionRunner: MultipleSelectionActionRunner | undefined;

	constructor(
		// private treeViewId: string,
		// private menus: TreeMenus,
		private labels: ResourceLabels,
		// private actionViewItemProvider: IActionViewItemProvider,
		// private aligner: Aligner,
		@IThemeService private readonly themeService: IThemeService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILabelService private readonly labelService: ILabelService
	) {
		super();
	}

	get templateId(): string {
		return TreeItemRenderer.TREE_TEMPLATE_ID;
	}

	// set actionRunner(actionRunner: MultipleSelectionActionRunner) {
	// 	this._actionRunner = actionRunner;
	// }

	renderTemplate(container: HTMLElement): ITreeExplorerTemplateData {
		container.classList.add('custom-view-tree-node-item');

		const icon = DOM.append(container, DOM.$('.custom-view-tree-node-item-icon'));

		const resourceLabel = this.labels.create(container, { supportHighlights: true });
		// const actionsContainer = DOM.append(resourceLabel.element, DOM.$('.actions'));
		// const actionBar = new ActionBar(actionsContainer, {
		// 	actionViewItemProvider: this.actionViewItemProvider
		// });

		return { resourceLabel, icon, container, elementDisposable: Disposable.None };
	}

	renderElement(element: ITreeNode<ITreeItemFromProvider, void>, index: number, templateData: ITreeExplorerTemplateData): void {
		templateData.elementDisposable.dispose();
		const node = element.element.element;
		const resource = node.resourceUri ? URI.revive(node.resourceUri) : null;
		const treeItemLabel: ITreeItemLabel | undefined = node.label ? node.label : resource ? { label: basename(resource) } : undefined;
		const description = isString(node.description) ? node.description : resource && node.description === true ? this.labelService.getUriLabel(dirname(resource), { relative: true }) : undefined;
		const label = treeItemLabel ? treeItemLabel.label : undefined;
		const icon = this.themeService.getColorTheme().type === ColorScheme.LIGHT ? node.icon : node.iconDark;
		const iconUrl = icon ? URI.revive(icon) : null;
		const title = node.tooltip ? isString(node.tooltip) ? node.tooltip : undefined : resource ? undefined : label;
		const sqlIcon = node.sqlIcon;

		// reset
		// templateData.actionBar.clear();

		if (resource || this.isFileKindThemeIcon(node.themeIcon)) {
			const fileDecorations = this.configurationService.getValue<{ colors: boolean, badges: boolean }>('explorer.decorations');
			templateData.resourceLabel.setResource({ name: label, description, resource: resource ? resource : URI.parse('missing:_icon_resource') }, { fileKind: this.getFileKind(node), title, hideIcon: !!iconUrl, fileDecorations, extraClasses: ['custom-view-tree-node-item-resourceLabel'] });
		} else {
			templateData.resourceLabel.setResource({ name: label, description }, { title, hideIcon: true, extraClasses: ['custom-view-tree-node-item-resourceLabel'] });
		}

		templateData.icon.title = title ? title : '';

		if (iconUrl || sqlIcon) {
			templateData.icon.className = 'custom-view-tree-node-item-icon';
			if (sqlIcon) {
				DOM.toggleClass(templateData.icon, sqlIcon, !!sqlIcon);  // tracked change
			}
			DOM.toggleClass(templateData.icon, 'icon', !!sqlIcon);
			templateData.icon.style.backgroundImage = iconUrl ? DOM.asCSSUrl(iconUrl) : '';
		} else {
			let iconClass: string | undefined;
			if (node.themeIcon && !this.isFileKindThemeIcon(node.themeIcon)) {
				iconClass = ThemeIcon.asClassName(node.themeIcon);
			}
			templateData.icon.className = iconClass ? `custom-view-tree-node-item-icon ${iconClass}` : '';
			templateData.icon.style.backgroundImage = '';
		}

		// templateData.actionBar.context = <TreeViewItemHandleArg>{ $treeViewId: this.treeViewId, $treeItemHandle: node.handle };
		// templateData.actionBar.push(this.menus.getResourceActions(node), { icon: true, label: false });
		// if (this._actionRunner) {
		// 	templateData.actionBar.actionRunner = this._actionRunner;
		// }
		this.setAlignment(templateData.container, node);
		templateData.elementDisposable = (this.themeService.onDidFileIconThemeChange(() => this.setAlignment(templateData.container, node)));
	}

	private setAlignment(container: HTMLElement, treeItem: ITreeItem) {
		// DOM.toggleClass(container.parentElement!, 'align-icon-with-twisty', this.aligner.alignIconWithTwisty(treeItem));
	}

	private isFileKindThemeIcon(icon: ThemeIcon | undefined): boolean {
		if (icon) {
			return icon.id === FileThemeIcon.id || icon.id === FolderThemeIcon.id;
		} else {
			return false;
		}
	}

	private getFileKind(node: ITreeItem): FileKind {
		if (node.themeIcon) {
			switch (node.themeIcon.id) {
				case FileThemeIcon.id:
					return FileKind.FILE;
				case FolderThemeIcon.id:
					return FileKind.FOLDER;
			}
		}
		return node.collapsibleState === TreeItemCollapsibleState.Collapsed || node.collapsibleState === TreeItemCollapsibleState.Expanded ? FileKind.FOLDER : FileKind.FILE;
	}

	disposeElement(resource: ITreeNode<ITreeItemFromProvider, void>, index: number, templateData: ITreeExplorerTemplateData): void {
		templateData.elementDisposable.dispose();
	}

	disposeTemplate(templateData: ITreeExplorerTemplateData): void {
		// templateData.resourceLabel.dispose();
		// templateData.actionBar.dispose();
		templateData.elementDisposable.dispose();
	}
}

class ContextKey extends Disposable implements IContextKey<ITreeItem> {
	static readonly ContextValue = new RawContextKey<string>('contextValue', undefined);
	static readonly Item = new RawContextKey<ITreeItem>('item', undefined);
	private _contextValueKey: IContextKey<string>;
	private _itemKey: IContextKey<ITreeItem>;

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService
	) {
		super();
		this._contextValueKey = ContextKey.ContextValue.bindTo(contextKeyService);
		this._itemKey = ContextKey.Item.bindTo(contextKeyService);
	}
	set(value: ITreeItem): void {
		this._contextValueKey.set(value.contextValue);
	}
	reset(): void {
		this._contextValueKey.reset();
	}
	get(): ITreeItem {
		return this._itemKey.get();
	}
}
