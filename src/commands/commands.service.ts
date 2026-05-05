import { Injectable, Logger } from '@nestjs/common';
import { ApplicationCommandType, Client, Collection } from 'discord.js';
import { CommandDiscovery } from './command.discovery';
import { ContextMenusService } from './context-menus';
import { SlashCommandsService } from './slash-commands';

/**
 * Represents a service that manages commands.
 * @url https://necord.org/interactions/slash-commands
 */
@Injectable()
export class CommandsService {
	private readonly logger = new Logger(CommandsService.name);

	public constructor(
		private readonly client: Client,
		private readonly contextMenusService: ContextMenusService,
		private readonly slashCommandsService: SlashCommandsService
	) {}

	/**
	 * Registers all commands.
	 *
	 */
	public async registerAllCommands() {
		const commandsByGuilds = this.getCommandsGroupedByGuilds();

		this.logger.log(`Started refreshing application commands.`);
		await Promise.all([
			this.registerGlobalCommands(),
			...commandsByGuilds.map((commands, guildId) =>
				this.registerCommandsInGuild(guildId, commands)
			)
		]);
		this.logger.log(`Successfully reloaded application commands.`);
	}

	public async registerGlobalCommands() {
		const commands = this.getGlobalCommands();
		const rawCommands = commands.flatMap(command => command.toJSON());
		/**
		 * Adding entry point commands to the payload to prevent DiscordAPIError[50240]
		 * "You cannot remove this app's Entry Point command in a bulk update operation"
		 **/
		const entryPointCommands = await this.getEntryPointCommands();

		const payload = [...rawCommands, ...entryPointCommands];

		if (payload.length === 0) {
			return;
		}

		this.logger.debug(`Registering ${payload.length} global application commands...`);
		return this.client.application.commands.set(payload).catch(error => {
			this.logger.error(
				`Failed to register application commands (global): ${error}`,
				error.stack
			);
			throw error;
		});
	}

	/**
	 * Registers commands in a guild.
	 * @param guildId
	 * @param commands
	 */
	public async registerCommandsInGuild(guildId: string, commands: CommandDiscovery[]) {
		if (!guildId) {
			throw new TypeError('Guild ID is required to register guild commands.');
		}

		const rawCommands = commands.flatMap(command => command.toJSON());

		this.logger.debug(`Registering ${rawCommands.length} guild commands in ${guildId}`);
		return this.client.application.commands.set(rawCommands, guildId).catch(error => {
			this.logger.error(
				`Failed to register application commands (guild: ${guildId}): ${error}`,
				error.stack
			);
			throw error;
		});
	}

	public getCommands(): CommandDiscovery[] {
		return [
			...this.contextMenusService.cache.values(),
			...this.slashCommandsService.cache.values()
		].flat();
	}

	public getCommandsGroupedByGuilds(): Collection<string, CommandDiscovery[]> {
		const collection = new Collection<string, CommandDiscovery[]>();
		const commands = this.getCommands();

		for (const command of commands) {
			const guilds = command.getGuilds();

			if (!guilds || guilds.length === 0) {
				continue;
			}

			for (const guildId of guilds) {
				const visitedCommands = collection.get(guildId) ?? [];
				collection.set(guildId, visitedCommands.concat(command));
			}
		}

		return collection;
	}

	public getCommandByName(name: string): CommandDiscovery {
		return this.getCommands().find(command => command.getName() === name);
	}

	public getGlobalCommands(): CommandDiscovery[] {
		return this.getCommands().filter(command => command.isGlobal());
	}

	public getGlobalCommandByName(name: string): CommandDiscovery {
		return this.getGlobalCommands().find(command => command.getName() === name);
	}

	public getGuildCommands(guildId: string): CommandDiscovery[] {
		return this.getCommandsGroupedByGuilds().get(guildId) ?? [];
	}

	public getGuildCommandByName(guildId: string, name: string): CommandDiscovery {
		return this.getGuildCommands(guildId).find(command => command.getName() === name);
	}

	private async getEntryPointCommands() {
		const existingCommands = await this.client.application.commands.fetch();

		return existingCommands
			.filter(cmd => cmd.type === ApplicationCommandType.PrimaryEntryPoint)
			.map(cmd => ({
				id: cmd.id,
				name: cmd.name,
				description: cmd.description,
				type: cmd.type,
				handler: cmd.handler
			}));
	}
}
